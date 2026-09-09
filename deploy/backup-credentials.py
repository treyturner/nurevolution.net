#!/usr/bin/python3
"""Prompt locally on the droplet to create its initial backup credentials."""

import getpass
import os
from pathlib import Path
import sys
import warnings


DIRECTORY = Path("/etc/nurevolution")


def environment_value(value):
    """Quote a value for systemd EnvironmentFile, without shell evaluation."""
    if not value or not value.isprintable():
        raise ValueError("Values must contain printable characters on one line")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_credentials(directory, secret, password):
    if len(secret) < 8:
        raise ValueError("The MinIO secret key must have at least 8 characters")
    if len(password) < 24:
        raise ValueError("Use at least 24 characters for the backup-encryption password")
    if secret == password:
        raise ValueError("Use different MinIO and backup-encryption secrets")
    environment_value(password)
    values = {
        "RESTIC_REPOSITORY": "s3:https://minio.treyturner.info/nurevolution-backups",
        "AWS_ACCESS_KEY_ID": "nurevolution-backup",
        "AWS_SECRET_ACCESS_KEY": secret,
        "RESTIC_PASSWORD_FILE": str(directory / "restic-password"),
        "RESTIC_CACHE_DIR": "/var/cache/nurevolution-restic",
        "AWS_DEFAULT_REGION": "us-east-1",
    }
    environment = "".join(
        f"{name}={environment_value(value)}\n" for name, value in values.items()
    )
    files = {
        directory / "restic-password": password + "\n",
        directory / "backup.env": environment,
    }
    if any(os.path.lexists(path) for path in files):
        raise FileExistsError("Backup credential files already exist; refusing to replace them")
    created = []
    try:
        for path, content in files.items():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except BaseException:
        for path in reversed(created):
            path.unlink()
        raise


def main():
    if os.geteuid() != 0:
        raise PermissionError("Run this on the droplet as root")
    if not sys.stdin.isatty():
        raise ValueError("Run interactively in your SSH terminal")
    if DIRECTORY.is_symlink():
        raise ValueError("Credential directory must not be a symlink")
    os.umask(0o077)
    DIRECTORY.mkdir(mode=0o700, exist_ok=True)
    if DIRECTORY.stat().st_uid != 0:
        raise PermissionError("Credential directory must be owned by root")
    DIRECTORY.chmod(0o700)
    if any(os.path.lexists(DIRECTORY / name) for name in ("backup.env", "restic-password")):
        raise FileExistsError("Backup credential files already exist; refusing to replace them")
    print("Keep both secrets in your password manager for recovery.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        secret = getpass.getpass("Existing MinIO secret for nurevolution-backup: ")
        password = getpass.getpass("New, separate backup-encryption password (24+ characters): ")
        confirmation = getpass.getpass("Repeat backup-encryption password: ")
    if password != confirmation:
        raise ValueError("Backup-encryption passwords did not match; no files written")
    write_credentials(DIRECTORY, secret, password)
    print("Saved root-only backup.env and restic-password in /etc/nurevolution.")
    print("Credentials are ready. The repository has not been initialized yet.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, getpass.GetPassWarning) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(1)
