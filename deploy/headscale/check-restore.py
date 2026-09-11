"""Exercise check-restore.sh against a disposable, populated Headscale server.

Run as root with Docker available. Uses private temporary files and task-owned
containers with no network, host mounts, or ports. No live credentials are read.
The separate check-backup.py exercises real restic encryption and file restore.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parent
IMAGE = 'ghcr.io/juanfont/headscale@sha256:0e7f1c6e4ce6c2a2a001103ecd3fa645a045adf30ac8a5234fe037b43000cd72'


def run(*args, timeout=120, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run this isolated restore test as root.')
    container = ''
    with tempfile.TemporaryDirectory(prefix='nurevolution-restore-check-') as temporary:
        root = Path(temporary)
        config = root / 'config'
        config.mkdir()
        for source, target in [('config.example.yaml', 'config.yaml'),
                               ('policy.example.json', 'policy.json')]:
            shutil.copyfile(ROOT / source, config / target)
            (config / target).chmod(0o644)
        try:
            container = run('docker', 'create', '--name',
                            'nurevolution-restore-source-' + uuid.uuid4().hex[:10],
                            '--network', 'none', '--cap-drop', 'ALL',
                            '--security-opt', 'no-new-privileges:true',
                            '--memory', '256m', '--pids-limit', '128',
                            '--tmpfs', '/var/run/headscale', IMAGE, 'serve').stdout.strip()
            run('docker', 'cp', str(config) + '/.', container + ':/etc/headscale')
            run('docker', 'start', container)
            for _ in range(30):
                if run('docker', 'exec', container, 'headscale', 'health',
                       check=False, timeout=3).returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Source fixture did not become healthy')
            run('docker', 'exec', container, 'headscale', 'users', 'create', 'restore-fixture')
            # Fixture-only enrollment output is captured and never printed.
            run('docker', 'exec', container, 'headscale', 'preauthkeys', 'create',
                '--tags', 'tag:nurevolution-deploy', '--expiration', '10m')
            run('docker', 'stop', '--time', '30', container)
            restored = root / 'restored'
            restored.mkdir(mode=0o700)
            run('docker', 'cp', container + ':/etc/headscale', str(restored / 'config'))
            run('docker', 'cp', container + ':/var/lib/headscale', str(restored / 'data'))
            run('chown', '-R', '99:100', str(restored / 'config'), str(restored / 'data'))
            (restored / 'metadata.json').write_text(json.dumps({'image': IMAGE}))
            # This fixture represents the verified-file handoff from backup.sh.
            snapshot = 'a' * 64
            (restored / '.headscale-restore.json').write_text(
                json.dumps({'hashesVerified': True, 'snapshotId': snapshot}))
            hashes = []
            for directory in ('config', 'data'):
                for file in sorted((restored / directory).rglob('*')):
                    if file.is_file():
                        hashes.append(hashlib.sha256(file.read_bytes()).hexdigest()
                                      + '  ' + str(file.relative_to(restored)))
            (restored / 'checksums.sha256').write_text('\n'.join(hashes) + '\n')
            run('bash', str(ROOT / 'check-restore.sh'), str(restored))
            report = json.loads((restored / 'restore-check.json').read_text())
            assert report['snapshotId'] == snapshot
            assert report['healthy'] is True
            assert report['serverKeysPreserved'] is True
            assert report['restoreFilesUnchanged'] is True
            assert report['network'] == 'none'
            assert report['savedEnrollmentKeyCount'] == 1
            assert report['savedUserCount'] == 1
            assert report['nodes'] == []  # Live node recovery is separate owner evidence.
            print('PASS isolated restored Headscale: healthy, both identities preserved, '
                  'one enrollment key and user recovered, restored files unchanged')
        finally:
            if container:
                run('docker', 'rm', '-f', container)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError:
        # Never dump captured command output; key creation is part of this test.
        raise SystemExit('Isolated Headscale restore test failed') from None
