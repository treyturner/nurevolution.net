#!/usr/bin/python3
"""Prompt on the droplet to save the edge's initial Cloudflare DNS token."""

import getpass
import os
from pathlib import Path
import re
import sys
import warnings


DIRECTORY = Path("/etc/nurevolution")


def write_token(directory, token):
    # Match the pinned Caddy provider, which includes invalid values in its errors.
    # Reject malformed input here without echoing it or forwarding it to Caddy logs.
    if not re.fullmatch(
        r"(?:[A-Za-z0-9_-]{35,50}|cf(?:ut|at)_[A-Za-z0-9_-]{32,256})", token
    ):
        raise ValueError("Paste the complete API token, without spaces or a Bearer prefix")
    path = directory / "cloudflare.env"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(f"CLOUDFLARE_API_TOKEN={token}\n")
            stream.flush()
            os.fsync(stream.fileno())
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except BaseException:
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
    if os.path.lexists(DIRECTORY / "cloudflare.env"):
        raise FileExistsError("Cloudflare credentials already exist; refusing to replace them")
    print("Keep a copy of this zone-scoped DNS token in your password manager.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        token = getpass.getpass("Cloudflare API token for nurevolution.net (hidden): ")
    write_token(DIRECTORY, token)
    print("Saved root-only /etc/nurevolution/cloudflare.env.")
    print("The token has not been verified; no DNS records or certificates were changed.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, getpass.GetPassWarning) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(1)
