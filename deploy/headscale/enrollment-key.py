#!/usr/bin/env python3
"""Accept a Headscale enrollment key without echo or shell-history exposure."""

import getpass
import os
from pathlib import Path
import stat
import sys


DIRECTORY = Path("/run/nurevolution-enrollment")
ROLES = ("droplet", "runner")


def save_key(directory, role, key):
    if role not in ROLES:
        raise ValueError("Role must be droplet or runner")
    if not 16 <= len(key) <= 512 or any(not 33 <= ord(c) <= 126 for c in key):
        raise ValueError("Enter only the enrollment key, without spaces or line breaks")
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise PermissionError("Enrollment directory must be private and owned by the current user")
    path = directory / (role + ".key")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as target:
        target.write(key)


def main():
    if os.geteuid() != 0:
        raise PermissionError("Run this command from the droplet's root SSH session")
    if len(sys.argv) != 2 or sys.argv[1] not in ROLES:
        raise ValueError("Usage: nurevolution-headscale-key droplet|runner")
    if not sys.stdin.isatty():
        raise ValueError("Run interactively so the enrollment key can be entered without echo")
    role = sys.argv[1]
    key = getpass.getpass(f"Paste the {role} enrollment key (hidden): ")
    save_key(DIRECTORY, role, key)
    print(f"Saved {role} enrollment key privately for this rehearsal.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, EOFError) as error:
        print(f"Unable to save enrollment key: {error}", file=sys.stderr)
        sys.exit(1)
