#!/usr/bin/python3
"""Configure and send Nurevolution backup alerts to the owner's Discord webhook."""

import getpass
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import urllib.error
import urllib.request
import warnings


DIRECTORY = Path("/etc/nurevolution")
WEBHOOK = DIRECTORY / "discord-webhook"


def validate_url(value):
    if not re.fullmatch(
        r"https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+", value
    ):
        raise ValueError("Use the complete HTTPS webhook URL copied from Discord")
    return value


def configure():
    if not sys.stdin.isatty():
        raise ValueError("Run configure interactively in your SSH terminal")
    if DIRECTORY.is_symlink():
        raise ValueError("Credential directory must not be a symlink")
    DIRECTORY.mkdir(mode=0o700, exist_ok=True)
    if DIRECTORY.stat().st_uid != 0:
        raise PermissionError("Credential directory must be owned by root")
    DIRECTORY.chmod(0o700)
    if os.path.lexists(WEBHOOK):
        raise FileExistsError("Discord webhook already exists; refusing to replace it")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        url = validate_url(getpass.getpass("Discord webhook URL (hidden): "))
    fd = os.open(WEBHOOK, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(url + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        fd = os.open(DIRECTORY, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except BaseException:
        WEBHOOK.unlink()
        raise
    print("Saved root-only /etc/nurevolution/discord-webhook; no message sent.")


def read_url():
    fd = os.open(WEBHOOK, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        metadata = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise PermissionError("Webhook must be a root-owned regular file, mode 0600")
        return validate_url(stream.read(4096).removesuffix("\n"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Unexpected redirect from Discord; webhook was not forwarded")


def send(event):
    if event not in ("failure", "test"):
        raise ValueError("Expected failure or test")
    url = read_url()
    if event == "failure":
        content = (
            f"Nurevolution backup FAILED on {socket.gethostname()}. "
            "Inspect nurevolution-backup.service and verify the last successful snapshot. "
            "New content requires a successful backup before publication is complete."
        )
    else:
        content = (
            f"Nurevolution backup alert TEST from {socket.gethostname()}. "
            "Discord notification delivery is working. This is a setup test."
        )
    payload = {"content": content, "allowed_mentions": {"parse": []}}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Nurevolution-Backup/1.0"},
    )
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=15) as response:
            if response.status not in (200, 204):
                raise ValueError("Unexpected Discord response status")
    except urllib.error.HTTPError as error:
        raise ValueError(f"Discord rejected the alert (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("Could not reach Discord to deliver the alert") from None
    print(f"Discord backup {event} alert delivered.")


def main():
    if os.geteuid() != 0:
        raise PermissionError("Run this on the droplet as root")
    os.umask(0o077)
    if len(sys.argv) != 2 or sys.argv[1] not in ("configure", "failure", "test"):
        raise ValueError("Usage: nurevolution-backup-alert configure|failure|test")
    if sys.argv[1] == "configure":
        configure()
    else:
        send(sys.argv[1])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, getpass.GetPassWarning) as error:
        print(f"Backup alert stopped: {error}", file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(1)
