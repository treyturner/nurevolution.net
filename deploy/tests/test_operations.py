import importlib.util
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import urllib.error


def load(name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).resolve().parents[1] / (name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load("backup-credentials")
cloudflare = load("cloudflare-credentials")
alert = load("backup-alert")


class Credentials(unittest.TestCase):
    def test_backup_files_are_private_and_preserve_shell_metacharacters(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            secret = 'dummy"\\$`MinIO-secret'
            password = "dummy backup password with $ and ` and enough characters"
            backup.write_credentials(directory, secret, password)
            self.assertEqual((directory / "restic-password").read_text(), password + "\n")
            self.assertIn('AWS_SECRET_ACCESS_KEY="dummy\\"\\\\$`MinIO-secret"\n',
                          (directory / "backup.env").read_text())
            for path in directory.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            before = (directory / "backup.env").read_bytes()
            with self.assertRaises(FileExistsError):
                backup.write_credentials(directory, "replacement-secret", password)
            self.assertEqual((directory / "backup.env").read_bytes(), before)

    def test_backup_rejects_control_characters_and_shared_passwords(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for secret, password in (
                ("invalid\nsecret", "x" * 32),
                ("valid-secret", "x" * 24 + "\n"),
                ("x" * 32, "x" * 32),
            ):
                with self.subTest(secret_length=len(secret)):
                    with self.assertRaises(ValueError):
                        backup.write_credentials(directory, secret, password)
                    self.assertEqual(list(directory.iterdir()), [])

    def test_account_token_survives_and_existing_file_or_symlink_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            token = "cfat_" + "A" * 64
            cloudflare.write_token(directory, token)
            path = directory / "cloudflare.env"
            self.assertEqual(path.read_text(), "CLOUDFLARE_API_TOKEN=" + token + "\n")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                cloudflare.write_token(directory, "B" * 40)
            self.assertIn(token, path.read_text())
            path.unlink()
            path.symlink_to(directory / "missing")
            with self.assertRaises(FileExistsError):
                cloudflare.write_token(directory, token)
            self.assertFalse((directory / "missing").exists())

    def test_cloudflare_rejects_environment_injection(self):
        with tempfile.TemporaryDirectory() as temp:
            for token in ("", "Bearer dummy", "a\nOTHER=variable", "${EXPANSION}", "`command`"):
                with self.subTest(token=token):
                    with self.assertRaises(ValueError):
                        cloudflare.write_token(Path(temp), token)
            self.assertEqual(list(Path(temp).iterdir()), [])


class Discord(unittest.TestCase):
    url = "https://discord.com/api/webhooks/123456789/dummy-webhook-token"

    def test_rejects_other_origins_and_unexpected_url_components(self):
        self.assertEqual(alert.validate_url(self.url), self.url)
        for url in (self.url.replace("https:", "http:"),
                    self.url.replace("discord.com", "discord.com.example.org"),
                    self.url.replace("discord.com", "user:pass@discord.com"),
                    self.url + "?redirect=example.org", self.url + "\n"):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    alert.validate_url(url)

    def test_refuses_insecure_credential_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "webhook"
            path.write_text(self.url + "\n")
            with patch.object(alert, "WEBHOOK", path):
                for mode, uid in ((0o644, 0), (0o600, 1000)):
                    with patch.object(alert.os, "fstat", return_value=SimpleNamespace(
                        st_mode=stat.S_IFREG | mode, st_uid=uid
                    )):
                        with self.assertRaises(PermissionError):
                            alert.read_url()
                with patch.object(alert.os, "fstat", return_value=SimpleNamespace(
                    st_mode=stat.S_IFREG | 0o600, st_uid=0
                )):
                    self.assertEqual(alert.read_url(), self.url)
                path.unlink()
                path.symlink_to(Path(temp) / "missing")
                with self.assertRaises(OSError):
                    alert.read_url()

    def test_sends_bounded_request_without_mentions_or_secret_in_message(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = '{"id":"123456789"}'
        with patch.object(alert, "read_url", return_value=self.url), \
                patch.object(alert.urllib.request, "build_opener", return_value=opener), \
                patch("builtins.print"):
            alert.send("failure")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.full_url, self.url + "?wait=true")
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 15)
        payload = json.loads(request.data)
        self.assertIn("FAILED", payload["content"])
        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        self.assertNotIn("dummy-webhook-token", payload["content"])

    def test_requires_confirmation_that_discord_saved_the_message(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        for status, body in ((204, ""), (200, "{}"), (200, "null"), (200, '{"id":""}')):
            response.status = status
            response.read.return_value = body
            with patch.object(alert, "read_url", return_value=self.url), \
                    patch.object(alert.urllib.request, "build_opener", return_value=opener):
                with self.assertRaises(ValueError):
                    alert.send("failure")

    def test_network_errors_do_not_expose_webhook_url(self):
        opener = MagicMock()
        for error in (urllib.error.HTTPError(self.url, 429, "rate limited", {}, None),
                      urllib.error.URLError(self.url)):
            opener.open.side_effect = error
            with patch.object(alert, "read_url", return_value=self.url), \
                    patch.object(alert.urllib.request, "build_opener", return_value=opener):
                with self.assertRaises(ValueError) as caught:
                    alert.send("test")
                self.assertNotIn("dummy-webhook-token", str(caught.exception))

    def test_redirect_does_not_forward_webhook(self):
        with self.assertRaises(ValueError):
            alert.NoRedirect().redirect_request(None, None, 302, "redirect", {}, self.url)


if __name__ == "__main__":
    unittest.main()
