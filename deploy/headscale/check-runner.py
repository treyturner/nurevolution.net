"""Exercise the actual workflow client against disposable Headscale and SSH.

Requires Docker; no live credentials, host mounts, privileged containers, host
network/PID namespaces, published ports, or shared-host firewall changes.
"""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parent
SERVER = 'ghcr.io/juanfont/headscale@sha256:0e7f1c6e4ce6c2a2a001103ecd3fa645a045adf30ac8a5234fe037b43000cd72'
NAME = 'nurevolution-runner-' + uuid.uuid4().hex[:10]
IMAGE = NAME + ':fixture'
containers = []


def run(*args, input=None, check=True, timeout=120):
    return subprocess.run(args, input=input, capture_output=True, text=True,
                          check=check, timeout=timeout)


def docker(*args, **kwargs):
    return run('docker', *args, **kwargs)


def execute(name, *args, user='2000', input=None, check=True, timeout=120):
    return docker('exec', '-i', '--user', user,
                  '-e', 'RUNNER_TEMP=/tmp/job', '-e', 'GITHUB_OUTPUT=/tmp/job/output',
                  '-e', 'HEADSCALE_URL=https://control',
                  '-e', 'HEADSCALE_HOSTNAME=' + name,
                  name, *args, input=input, check=check, timeout=timeout)


def client(name, *args, **kwargs):
    return execute(name, '/tmp/job/headscale/tailscale',
                   '--socket=/tmp/job/headscale/tailscaled.sock', *args, **kwargs)


def nodes(control):
    return json.loads(docker('exec', control, 'headscale', 'nodes', 'list', '-o', 'json').stdout)


def main():
    with tempfile.TemporaryDirectory(prefix=NAME) as temporary:
        temp = Path(temporary)
        config = temp / 'config'
        config.mkdir()
        fixture = temp / 'fixture'
        # OpenSSH rejects group-writable parents of AuthorizedKeysFile. GitHub's
        # umask may be 0002; do not let it choose this fixture's trust boundary.
        fixture.mkdir(mode=0o755)
        for name in ('runner.py', 'tailscale-client.json'):
            shutil.copyfile(ROOT / name, fixture / name)
        run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-keyout', str(config / 'tls.key'), '-out', str(config / 'tls.crt'),
            '-subj', '/CN=control', '-addext', 'subjectAltName=DNS:control')
        shutil.copyfile(config / 'tls.crt', fixture / 'tls.crt')
        source = (ROOT / 'config.example.yaml').read_text()
        for old, new in [
            ('https://headscale.treyturner.info', 'https://control'),
            ('0.0.0.0:8080', '0.0.0.0:443'),
            ("tls_cert_path: ''", 'tls_cert_path: /etc/headscale/tls.crt'),
            ("tls_key_path: ''", 'tls_key_path: /etc/headscale/tls.key'),
        ]:
            source = source.replace(old, new)
        (config / 'config.yaml').write_text(source)
        shutil.copyfile(ROOT / 'policy.example.json', config / 'policy.json')
        for name in ('host', 'identity'):
            run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(fixture / name))
            (fixture / name).chmod(0o600)
            (fixture / (name + '.pub')).chmod(0o644)
        (fixture / 'sshd_config').write_text('''
Port 22
HostKey /fixture/host
AuthorizedKeysFile /fixture/identity.pub
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers fixture
LogLevel VERBOSE
Subsystem sftp internal-sftp
''')
        (fixture / 'payload').write_text('verified release transfer fixture\n')
        # Test-only private keys are readable by the fixture operator.
        (fixture / 'identity').chmod(0o644)
        print('Building the isolated client/SSH fixture', flush=True)
        docker('build', '-t', IMAGE, str(ROOT / 'test-fixture'), timeout=300)
        docker('network', 'create', NAME)
        control = NAME + '-control'
        containers.append(control)
        docker('create', '--name', control, '--network', NAME, '--network-alias', 'control',
               '--tmpfs', '/var/lib/headscale', '--tmpfs', '/var/run/headscale', SERVER, 'serve')
        docker('cp', str(config) + '/.', control + ':/etc/headscale')
        docker('start', control)
        for _ in range(60):
            if docker('exec', control, 'headscale', 'health', check=False).returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('Fixture Headscale did not become healthy')
        target = NAME + '-target'
        runner = NAME + '-runner'
        for name, tag in ((target, 'droplet'), (runner, 'deploy')):
            containers.append(name)
            restrictions = ['--cap-drop=ALL'] if name == runner else []
            docker('run', '-d', '--name', name, '--network', NAME, *restrictions, IMAGE)
            docker('cp', str(fixture), name + ':/fixture')
            if name == target:
                # Docker copy can retain the invoking host UID. The SSH fixture
                # uses UID 2000 so common host UIDs cannot mask wrong ownership.
                execute(name, 'chown', '-R', '0:0', '/fixture', user='0')
            execute(name, 'sh', '-ec', '''
cp /fixture/tls.crt /usr/local/share/ca-certificates/fixture.crt
update-ca-certificates >/dev/null 2>&1
''', user='0')
            execute(name, 'mkdir', '-m', '700', '/tmp/job')
            # The server creates disposable, fixture-only keys; none are logged.
            enrollment = json.loads(docker('exec', control, 'headscale', 'preauthkeys',
                'create', '--tags', 'tag:nurevolution-' + tag, '--ephemeral',
                '--expiration', '10m', '-o', 'json').stdout)
            execute(name, 'sh', '-ec',
                    'umask 077; mkdir /tmp/job/headscale; cat > /tmp/job/headscale/auth.key',
                    input=enrollment['key'])
            before = execute(name, 'sh', '-ec', 'ip -j address; ip -j route; cat /etc/resolv.conf').stdout
            print('Starting the real workflow helper: ' + tag, flush=True)
            execute(name, 'python3', '/fixture/runner.py', 'start')
            after = execute(name, 'sh', '-ec', 'ip -j address; ip -j route; cat /etc/resolv.conf').stdout
            assert before == after, 'Client changed host interfaces, routing, or DNS'
            execute(name, 'test', '!', '-e', '/tmp/job/headscale/auth.key')
            prefs = json.loads(client(name, 'debug', 'prefs').stdout)
            assert not prefs['CorpDNS'] and not prefs['RouteAll'] and not prefs['RunSSH']
        # Reproduce the original parser failure using the very same pinned binary.
        duplicate = client(runner, 'up', '--accept-routes', '--accept-routes=false', '--help', check=False)
        assert duplicate.returncode != 0 and 'flag provided multiple times' in duplicate.stderr
        execute(target, '/usr/sbin/sshd', '-f', '/fixture/sshd_config', '-E', '/tmp/sshd.log', user='0')
        address = json.loads(client(target, 'status', '--json').stdout)['TailscaleIPs'][0]
        known_host = address + ' ' + (fixture / 'host.pub').read_text()
        execute(runner, 'sh', '-ec', '''
umask 077
cat > /tmp/job/known_hosts
cp /fixture/identity /tmp/job/identity
chmod 600 /tmp/job/identity
''', input=known_host)
        output = execute(runner, 'cat', '/tmp/job/output').stdout.strip()
        proxy = output.removeprefix('proxy_command=')
        ssh_args = ['-i', '/tmp/job/identity', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
                    '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/tmp/job/known_hosts',
                    '-o', 'ProxyCommand=' + proxy, '-o', 'ConnectTimeout=15']
        print('Verifying pinned OpenSSH identity and SCP through tailscale nc', flush=True)
        result = execute(runner, 'ssh', *ssh_args, 'fixture@' + address, 'id -un')
        assert result.stdout.strip() == 'fixture'
        execute(runner, 'sh', '-ec', 'cat > /tmp/job/wrong_host',
                input=address + ' ' + (fixture / 'identity.pub').read_text())
        wrong_args = ['UserKnownHostsFile=/tmp/job/wrong_host' if arg ==
                      'UserKnownHostsFile=/tmp/job/known_hosts' else arg for arg in ssh_args]
        wrong = execute(runner, 'ssh', *wrong_args, 'fixture@' + address, 'id -un', check=False)
        assert wrong.returncode == 255 and 'Host key verification failed' in wrong.stderr
        execute(runner, 'scp', *ssh_args, '/fixture/payload', 'fixture@' + address + ':/tmp/payload')
        assert execute(target, 'cat', '/tmp/payload').stdout == (fixture / 'payload').read_text()
        # A live HTTP listener is reachable locally but denied over the private policy.
        # Deliberately bind late so this test exercises listener readiness.
        docker('exec', '-d', target, 'sh', '-c', 'sleep 1; exec python3 -m http.server 443')
        execute(target, 'python3', '-c', '''
import time, urllib.request
deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen("http://127.0.0.1:443", timeout=1) as response:
            if response.status == 200:
                break
    except OSError:
        pass
    time.sleep(0.1)
else:
    raise SystemExit("Fixture HTTP listener did not become ready within 10 seconds")
''')
        try:
            client(runner, 'nc', address, '443', timeout=5)
        except subprocess.TimeoutExpired:
            pass
        else:
            raise AssertionError('Private policy unexpectedly allowed TCP 443')
        print('Verifying logout and cleanup, including repeated cleanup', flush=True)
        for name in (runner, target):
            execute(name, 'python3', '/fixture/runner.py', 'stop')
            execute(name, 'test', '!', '-e', '/tmp/job/headscale')
            execute(name, 'python3', '/fixture/runner.py', 'stop')
        for _ in range(30):
            if not nodes(control):
                break
            time.sleep(0.2)
        else:
            raise AssertionError('Ephemeral fixture clients remained after logout')
        print('Verifying failed enrollment also consumes its key and supports cleanup', flush=True)
        enrollment = json.loads(docker('exec', control, 'headscale', 'preauthkeys', 'create',
            '--tags', 'tag:nurevolution-deploy', '--ephemeral', '--expiration', '10m',
            '-o', 'json').stdout)
        docker('exec', control, 'headscale', 'preauthkeys', 'expire', '--id', str(enrollment['id']))
        execute(runner, 'sh', '-ec',
                'umask 077; mkdir /tmp/job/headscale; cat > /tmp/job/headscale/auth.key',
                input=enrollment['key'])
        rejected = execute(runner, 'python3', '/fixture/runner.py', 'start', check=False)
        assert rejected.returncode != 0 and 'Tailscale enrollment failed' in rejected.stderr
        assert enrollment['key'] not in rejected.stdout + rejected.stderr
        execute(runner, 'test', '!', '-e', '/tmp/job/headscale/auth.key')
        execute(runner, 'python3', '/fixture/runner.py', 'stop')
        execute(runner, 'test', '!', '-e', '/tmp/job/headscale')
        assert not nodes(control)
        print('Passed: real enrollment, unchanged host network, SSH, SCP, deny policy, logout, failure cleanup.', flush=True)


try:
    main()
except subprocess.CalledProcessError as error:
    # Captured enrollment output is never printed, even when its command fails.
    if 'preauthkeys' not in error.cmd:
        print(error.stdout)
        print(error.stderr)
    for name in containers:
        if name.endswith('-target'):
            # Fixture-only SSH diagnostics contain public fingerprints, never
            # enrollment credentials or private key bytes.
            diagnostics = execute(name, 'sh', '-c',
                'stat -c "%a %u:%g %n" / /fixture /fixture/identity.pub /home/fixture; '
                'cat /tmp/sshd.log', user='0', check=False)
            print(diagnostics.stdout)
    raise SystemExit('Runner integration failed') from None
finally:
    for name in reversed(containers):
        docker('rm', '-f', name, check=False)
    docker('network', 'rm', NAME, check=False)
    docker('image', 'rm', IMAGE, check=False)
