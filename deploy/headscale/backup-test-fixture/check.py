import hashlib
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import time

root = Path('/test')
root.mkdir(mode=0o700)
backup = root / 'backup'
backup.mkdir(mode=0o700)
(backup / 'restic-password').write_text('fixture-only-password-not-a-live-secret')
(backup / 'restic-password').chmod(0o600)
(root / 'rclone.conf').write_text('[local]\ntype = local\n')
source = Path('/source/headscale')
for directory in ('config', 'data'):
    (source / directory).mkdir(parents=True)
for file in ('config/config.yaml', 'config/policy.json', 'data/db.sqlite', 'data/noise_private.key', 'data/derp_server_private.key'):
    (source / file).write_text('fixture-private-' + file)
binpath = root / 'bin'
binpath.mkdir()
docker = binpath / 'docker'
docker.write_text('''#!/usr/bin/python3
import json, os, sys
from pathlib import Path
state = Path('/test/running')
args = sys.argv[1:]
with Path('/test/docker-calls').open('a') as log: log.write(json.dumps(args)+'\\n')
if args[0] == 'ps': print('fixture-headscale')
elif args[0] == 'inspect':
    if args[2] == '{{.State.Running}}': print(state.read_text())
    elif args[2] == '{{json .Mounts}}': print(json.dumps([
      {'Type':'bind','Source':'/source/headscale/config','Destination':'/etc/headscale','RW':False},
      {'Type':'bind','Source':'/source/headscale/data','Destination':'/var/lib/headscale','RW':True}]))
    elif args[2] == '{{json .Config.Image}}': print(json.dumps('fixture-image'))
    else: sys.exit(4)
elif args[0] == 'stop':
    state.write_text('false')
    if os.getenv('FAIL_STOP'): sys.exit(42)
elif args[0] == 'start': state.write_text('true')
elif args[0] == 'exec': sys.exit(0 if state.read_text() == 'true' else 1)
else: sys.exit(4)
''')
docker.chmod(0o755)
(binpath / 'cp').write_text('''#!/bin/bash
[[ ${FAIL_COPY:-} != 1 ]] || exit 42
exec /bin/cp "$@"
''')
(binpath / 'cp').chmod(0o755)
(binpath / 'restic').write_text('''#!/bin/bash
for arg in "$@"; do
  if [[ $arg == backup ]]; then
    [[ $(cat /test/running) == true ]] || { echo 'Upload started before Headscale restarted' >&2; exit 99; }
    [[ ${FAIL_UPLOAD:-} != 1 ]] || exit 42
  fi
done
exec /usr/bin/restic "$@"
''')
(binpath / 'restic').chmod(0o755)
env = {**os.environ, 'PATH':f'{binpath}:'+os.environ['PATH'],
  'HS_SOURCE_ROOT':str(source), 'HS_BACKUP_ROOT':str(backup),
  'HS_RESTIC':str(binpath/'restic'), 'HS_RCLONE_CONFIG':str(root/'rclone.conf'),
  'HS_REPOSITORY':'rclone:local:/test/repository'}
(root / 'running').write_text('true')
checks = []
def run(*args, ok=True, extra=None):
    result = subprocess.run(['bash', '/helper.sh', *args], env={**env, **(extra or {})}, text=True, capture_output=True, timeout=120)
    if (result.returncode == 0) != ok:
        print(result.stdout, result.stderr)
        raise AssertionError((args, result.returncode))
    return result
def passed(label):
    checks.append(label)
    print('PASS', label, flush=True)
def terminal(*args):
    master, slave = pty.openpty()
    process = subprocess.Popen(['bash', '/helper.sh', *args], env=env,
                               stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = bytearray()
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == 5: break  # PTY slave closed.
                    raise
                if not chunk: break
                output.extend(chunk)
            elif process.poll() is not None:
                break
        assert process.wait(timeout=1) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
    return output.decode()
run('init')
run('backup')
accepted = (backup/'last-success.json').read_bytes()
snapshot = json.loads(accepted)['snapshotId']
assert len(snapshot) == 64
assert not (backup/'capture').exists()
run('check')
run('restore', snapshot, '/test/restore')
for file in source.rglob('*'):
    if file.is_file(): assert file.read_bytes() == (root/'restore'/file.relative_to(source)).read_bytes()
assert json.loads((root/'restore/.headscale-restore.json').read_text())['hashesVerified'] is True
passed('real restic 0.19.1 + rclone init, encrypted backup, full check, exact restore after service restart')
run('restore', snapshot, '/test/restore', ok=False)
run('restore', snapshot, '/source/headscale/unsafe', ok=False)
assert not (source/'unsafe').exists()
passed('existing and live-directory restore destinations refused')
for flag in ('FAIL_STOP', 'FAIL_COPY', 'FAIL_UPLOAD'):
    run('backup', ok=False, extra={flag:'1'})
    assert (root/'running').read_text() == 'true'
    assert (backup/'last-success.json').read_bytes() == accepted
    assert not (backup/'capture').exists()
    passed(flag + ': service running, failed capture cleaned, accepted snapshot unchanged')
calls = (root/'docker-calls').read_bytes()
run('backup', ok=False, extra={'HS_REPOSITORY':'rclone:local:/test/absent'})
assert calls == (root/'docker-calls').read_bytes()
passed('repository failure leaves running service untouched')
(root/'running').write_text('false')
run('backup', ok=False)
assert (root/'running').read_text() == 'false'
passed('intentionally stopped service stays stopped')
(root/'running').write_text('true')
(backup/'capture').mkdir()
(backup/'capture/keep').write_text('existing capture')
run('backup', ok=False)
assert (backup/'capture/keep').read_text() == 'existing capture'
assert (root/'running').read_text() == 'true'
(backup/'capture/keep').unlink()
(backup/'capture').rmdir()
passed('existing capture preserved without stopping service')
run('retention')
passed('real restic retention dry run')
assert 'vault' in terminal('snapshots')
assert 'Applying Policy: keep 4 weekly, 3 monthly snapshots' in terminal('retention')
passed('interactive snapshot and retention output is visible through a real PTY')
(backup/'retention-enabled').touch()
run('backup')
run('check')
passed('explicit retention marker allows scoped forget and prune')
Path('/result.json').write_text(json.dumps({'checks':checks, 'snapshot':snapshot, 'restic':subprocess.check_output(['/usr/bin/restic','version'],text=True).strip(), 'rclone':subprocess.check_output(['rclone','version'],text=True).splitlines()[0], 'limits':'Lifecycle fault injection uses a Docker command fixture; repository encryption, rclone transport, backup and restore use real clients. Live Google Drive and Headscale restore remain owner acceptance.'},indent=2)+'\n')
