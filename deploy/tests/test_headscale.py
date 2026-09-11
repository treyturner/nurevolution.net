import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "headscale_key", Path(__file__).resolve().parents[1] / "headscale/enrollment-key.py"
)
enrollment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrollment)


class EnrollmentKey(unittest.TestCase):
    def test_cli_requires_root_and_a_terminal_before_reading_secrets(self):
        with patch.object(enrollment.getpass, "getpass") as prompt, \
                patch.object(enrollment.sys, "argv", ["key-entry", "droplet"]):
            with patch.object(enrollment.os, "geteuid", return_value=1000):
                with self.assertRaises(PermissionError):
                    enrollment.main()
            with patch.object(enrollment.os, "geteuid", return_value=0), \
                    patch.object(enrollment.sys.stdin, "isatty", return_value=False):
                with self.assertRaises(ValueError):
                    enrollment.main()
            prompt.assert_not_called()

    def test_private_file_preserves_opaque_key_without_shell_evaluation(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "keys"
            key = 'dummy-enrollment-$`"-key'
            enrollment.save_key(directory, "droplet", key)
            self.assertEqual((directory / "droplet.key").read_text(), key)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((directory / "droplet.key").stat().st_mode), 0o600)

    def test_existing_key_and_symlink_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "keys"
            enrollment.save_key(directory, "runner", "original-enrollment-key")
            with self.assertRaises(FileExistsError):
                enrollment.save_key(directory, "runner", "replacement-enrollment-key")
            self.assertEqual((directory / "runner.key").read_text(), "original-enrollment-key")
            (directory / "droplet.key").symlink_to(directory / "runner.key")
            with self.assertRaises(FileExistsError):
                enrollment.save_key(directory, "droplet", "replacement-enrollment-key")

    def test_rejects_insecure_directory_and_directory_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "keys"
            directory.mkdir(mode=0o755)
            with self.assertRaises(PermissionError):
                enrollment.save_key(directory, "droplet", "dummy-enrollment-key")
            directory.chmod(0o700)
            link = Path(temp) / "link"
            link.symlink_to(directory)
            with self.assertRaises(PermissionError):
                enrollment.save_key(link, "droplet", "dummy-enrollment-key")
            self.assertEqual(list(directory.iterdir()), [])

    def test_invalid_input_does_not_create_files_or_expose_the_key(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "keys"
            for role, key in [("../escape", "dummy-enrollment-key"),
                              ("droplet", "secret key with spaces"),
                              ("runner", "dummy-key-with-newline\n"),
                              ("runner", "x" * 513), ("runner", "short")]:
                with self.subTest(role=role, length=len(key)):
                    with self.assertRaises(ValueError) as error:
                        enrollment.save_key(directory, role, key)
                    self.assertNotIn(key, str(error.exception))
                    self.assertFalse(directory.exists())


if __name__ == "__main__":
    unittest.main()
