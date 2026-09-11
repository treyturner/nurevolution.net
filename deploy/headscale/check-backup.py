"""Test backup/recovery and capture failures with real restic/rclone.

Usage: python3 deploy/headscale/check-backup.py /path/to/restic-0.19.1
The supplied binary must be Linux/amd64. Only task-owned Docker resources are
used; no host mounts, live credentials, or live Headscale service are accessed.
"""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid


ROOT = Path(__file__).resolve().parent


def run(*args, timeout=120):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=timeout)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    restic = Path(sys.argv[1]).resolve(strict=True)
    if not run(str(restic), 'version').stdout.startswith('restic 0.19.1 '):
        raise SystemExit('Expected restic 0.19.1')
    name = 'nurevolution-backup-check-' + uuid.uuid4().hex[:10]
    image = name + ':fixture'
    container = ''
    try:
        with tempfile.TemporaryDirectory(prefix=name) as temporary:
            context = Path(temporary)
            shutil.copyfile(ROOT / 'backup-test-fixture/Dockerfile', context / 'Dockerfile')
            shutil.copyfile(restic, context / 'restic')
            (context / 'restic').chmod(0o755)
            run('docker', 'build', '-t', image, str(context), timeout=300)
        container = run('docker', 'run', '-d', '--init', '--network', 'none',
                        '--name', name, image).stdout.strip()
        run('docker', 'cp', str(ROOT / 'backup.sh'), container + ':/helper.sh')
        run('docker', 'cp', str(ROOT / 'backup-test-fixture/check.py'), container + ':/test.py')
        result = run('docker', 'exec', container, 'python3', '/test.py', timeout=300)
        print(result.stdout, end='')
        evidence = json.loads(run('docker', 'exec', container, 'cat', '/result.json').stdout)
        print(json.dumps(evidence, indent=2))
    except subprocess.CalledProcessError as error:
        print(error.stdout, error.stderr, file=sys.stderr)
        raise
    finally:
        if container:
            run('docker', 'rm', '-f', container)
        subprocess.run(['docker', 'image', 'rm', image], capture_output=True)


if __name__ == '__main__':
    main()
