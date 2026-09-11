#!/usr/bin/env python3
"""Run the pinned deployment client without changing the runner's host network."""

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
from urllib.parse import urlsplit


def private_directory():
    directory = Path(os.environ['RUNNER_TEMP']).absolute() / 'headscale'
    if directory.exists() or directory.is_symlink():
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError('Headscale directory must be private and owned by this runner')
    return directory


def client(directory, *args, timeout=15):
    return subprocess.run(
        [str(directory / 'tailscale'), '--socket=' + str(directory / 'tailscaled.sock'), *args],
        capture_output=True, text=True, timeout=timeout,
    )


def stop(directory):
    if not directory.exists():
        return
    pid_file = directory / 'daemon.pid'
    if pid_file.exists():
        pid = int(pid_file.read_text())
        executable = Path(f'/proc/{pid}/exe')
        if executable.exists():
            if executable.resolve() != directory / 'tailscaled':
                raise ValueError('Refusing to stop a process outside this runner client')
            try:
                result = client(directory, 'logout')
                if result.returncode:
                    print('Client logout failed; server inactivity cleanup remains required', file=sys.stderr)
            except subprocess.TimeoutExpired:
                print('Client logout timed out; server inactivity cleanup remains required', file=sys.stderr)
            finally:
                try:
                    os.kill(pid, signal.SIGTERM)
                    for _ in range(30):
                        if not executable.exists():
                            break
                        time.sleep(0.1)
                    if executable.exists() and executable.resolve() == directory / 'tailscaled':
                        os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    shutil.rmtree(directory)


def start(directory):
    auth_file = directory / 'auth.key'
    try:
        info = auth_file.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError('Enrollment file must be private and owned by this runner')
        key = auth_file.read_text()
        if not key or len(key) > 512 or any(character.isspace() for character in key):
            raise ValueError('Invalid enrollment credential')
        url = urlsplit(os.environ['HEADSCALE_URL'])
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or url.path or url.query or url.fragment):
            raise ValueError('HEADSCALE_URL must be an HTTPS origin')
        hostname = os.environ['HEADSCALE_HOSTNAME']
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', hostname):
            raise ValueError('Invalid deployment client hostname')
        if (directory / 'daemon.pid').exists():
            raise ValueError('A client already exists; stop it before starting another')
        pin = json.loads(Path(__file__).with_name('tailscale-client.json').read_text())
        if pin['platform'] != 'linux/amd64' or os.uname().machine != 'x86_64':
            raise ValueError('Expected the pinned Linux/amd64 client')
        archive = directory / 'client.tgz'
        digest = hashlib.sha256()
        with urllib.request.urlopen(pin['archive'], timeout=30) as response, archive.open('xb') as target:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                target.write(chunk)
        if digest.hexdigest() != pin['sha256']:
            raise ValueError('Tailscale archive checksum mismatch')
        with tarfile.open(archive, 'r:gz') as bundle:
            for name in ('tailscale', 'tailscaled'):
                member = bundle.getmember(f'tailscale_{pin["version"]}_amd64/{name}')
                if not member.isfile():
                    raise ValueError('Expected a regular client binary')
                with bundle.extractfile(member) as source, (directory / name).open('xb') as target:
                    shutil.copyfileobj(source, target)
                (directory / name).chmod(0o700)
        archive.unlink()
        with (directory / 'daemon.log').open('x') as log:
            daemon = subprocess.Popen(
                [str(directory / 'tailscaled'), '--tun=userspace-networking', '--state=mem:',
                 '--socket=' + str(directory / 'tailscaled.sock'), '--no-logs-no-support'],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
            )
        (directory / 'daemon.pid').write_text(str(daemon.pid))
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if daemon.poll() is not None:
                raise RuntimeError('Tailscale daemon exited during startup')
            if (directory / 'tailscaled.sock').exists():
                try:
                    if client(directory, 'status', '--json', timeout=2).returncode == 0:
                        break
                except subprocess.TimeoutExpired:
                    pass
            time.sleep(0.2)
        else:
            raise RuntimeError('Tailscale daemon did not become ready')
        result = client(
            directory, 'up', '--login-server=' + os.environ['HEADSCALE_URL'],
            '--auth-key=file:' + str(auth_file), '--hostname=' + hostname,
            '--accept-dns=false', '--accept-routes=false', '--ssh=false', '--timeout=45s', timeout=60,
        )
        if result.returncode:
            diagnostic = result.stderr.replace(key, '[redacted]')
            raise RuntimeError('Tailscale enrollment failed: ' + diagnostic[:1500])
        state = json.loads(client(directory, 'status', '--json').stdout)
        prefs = json.loads(client(directory, 'debug', 'prefs').stdout)
        if (state['BackendState'] != 'Running' or prefs['CorpDNS'] or prefs['RouteAll']
                or prefs['RunSSH'] or prefs['AdvertiseRoutes'] or prefs['ExitNodeID']
                or prefs['ExitNodeIP']):
            raise RuntimeError('Client does not match the deployment network policy')
        command = shlex.join([str(directory / 'tailscale'),
                              '--socket=' + str(directory / 'tailscaled.sock'), 'nc']) + ' %h %p'
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write('proxy_command=' + command + '\n')
        print('Private deployment client connected; host routing and DNS unchanged.')
    finally:
        auth_file.unlink(missing_ok=True)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        directory = private_directory()
        if sys.argv[1:] == ['start']:
            start(directory)
        elif sys.argv[1:] == ['stop']:
            stop(directory)
        else:
            raise ValueError('Usage: runner.py start|stop')
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
