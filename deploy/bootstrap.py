#!/usr/bin/env python3
"""Select verified release tooling without executing code from an incoming upload.

Installed once by the operator. Uses only Python's standard library; its trust
root is GitHub's authenticated HTTPS API, not the candidate deploy.mjs.
"""
import argparse
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile


REPOSITORY = 'treyturner/nurevolution.net'
API = 'https://api.github.com/repos/' + REPOSITORY
FILES = ('release.json', 'manifest.json', 'configuration.json', 'deploy.mjs',
         'renderer.sha256', 'delivery-evidence.json')
LIMIT = 32 * 1024 * 1024
RUNTIME_CONFIG = Path('/usr/local/lib/nurevolution/node-runtime.json')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(run_id, commit):
    require(re.fullmatch(r'[1-9][0-9]*', run_id), 'Invalid verification run ID')
    require(re.fullmatch(r'[a-f0-9]{40}', commit), 'Invalid release commit')


def regular(path):
    require(stat.S_ISREG(path.lstat().st_mode), 'Expected a regular file: ' + str(path))
    require(path.stat().st_size <= LIMIT, 'File is too large: ' + str(path))
    return path.read_bytes()


def directory(path):
    require(path.is_absolute(), 'Expected an absolute directory')
    for parent in (path, *path.parents):
        require(not parent.is_symlink(), 'Unexpected directory symlink: ' + str(parent))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(path.is_dir(), 'Expected a directory: ' + str(path))


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write(path, data):
    with path.open('xb') as output:
        os.chmod(path, 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        return None


def request(url, token=None):
    require(urllib.parse.urlsplit(url).scheme == 'https', 'HTTPS is required')
    headers = {'User-Agent': 'nurevolution-release-bootstrap',
               'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        require(url.startswith(API + '/'), 'Credentials are restricted to the repository API')
        headers['Authorization'] = 'Bearer ' + token
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=30) as response:
            data = response.read(LIMIT + 1)
            require(len(data) <= LIMIT, 'GitHub response exceeded the size limit')
            return data
    except urllib.error.HTTPError as error:
        try:
            if error.code == 302 and token and url.endswith('/zip'):
                # The storage URL is signed. Never forward the GitHub token to it.
                return request(error.headers['Location'])
            raise ValueError(f'GitHub artifact request failed (HTTP {error.code})') from None
        finally:
            error.close()
    except urllib.error.URLError:
        # Signed storage URLs and credentials must not appear in error logs.
        raise ValueError('GitHub artifact request failed; check network access') from None


def download(run_id, commit, token):
    identity(run_id, commit)
    require(token and len(token) <= 4096 and not re.search(r'\s', token),
            'Provide the temporary GitHub Actions read token on stdin')
    run = json.loads(request(f'{API}/actions/runs/{run_id}', token))
    require(run.get('event') == 'push' and run.get('conclusion') == 'success'
            and run.get('head_branch') == 'main' and run.get('head_sha') == commit
            and run.get('path') == '.github/workflows/verify.yml'
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('head_repository', {}).get('full_name') == REPOSITORY,
            'Release must come from successful main verification in ' + REPOSITORY)
    matches = []
    for page in range(1, 11):
        listing = json.loads(request(
            f'{API}/actions/runs/{run_id}/artifacts?per_page=100&page={page}', token))
        artifacts = listing['artifacts']
        matches.extend(item for item in artifacts if item['name'] == 'release-' + commit)
        if len(artifacts) < 100:
            break
    else:
        raise ValueError('Too many artifacts in the verification run')
    require(len(matches) == 1, 'Expected exactly one release artifact')
    artifact = matches[0]
    source = artifact.get('workflow_run', {})
    require(not artifact['expired'] and 0 < artifact['size_in_bytes'] <= LIMIT
            and source.get('id') == int(run_id) and source.get('head_sha') == commit
            and source.get('head_branch') == 'main'
            and source.get('repository_id') == run['repository']['id']
            and source.get('head_repository_id') == run['repository']['id'],
            'Expired, oversized, or mismatched release artifact')
    expected = artifact.get('digest') or ''
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', expected), 'Missing GitHub artifact digest')
    archive = request(f'{API}/actions/artifacts/{int(artifact["id"])}/zip', token)
    require('sha256:' + digest(archive) == expected, 'GitHub artifact checksum mismatch')
    return archive, {'runId': run_id, 'sourceCommit': commit,
                     'artifactId': artifact['id'], 'archiveSha256': expected[7:]}


def unpack(archive, provenance):
    require(digest(archive) == provenance['archiveSha256'], 'Cached artifact checksum mismatch')
    run_id, commit = provenance['runId'], provenance['sourceCommit']
    identity(run_id, commit)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        names = zipped.namelist()
        require(len(names) == len(FILES) and set(names) == set(FILES),
                'Unexpected, duplicate, or missing release archive entries')
        require(sum(entry.file_size for entry in zipped.infolist()) <= LIMIT,
                'Expanded release exceeds the size limit')
        require(all(not stat.S_ISLNK(entry.external_attr >> 16) for entry in zipped.infolist()),
                'Release archive symlinks are forbidden')
        files = {name: zipped.read(name) for name in FILES}
    release = json.loads(files['release.json'])
    config = json.loads(files['configuration.json'])
    manifest = json.loads(files['manifest.json'])
    require(all(item.get('sourceCommit') == commit for item in (release, config, manifest))
            and release.get('verifyRunUrl') == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}',
            'Release source identity mismatch')
    require(digest(files['configuration.json']) == release.get('configurationSha256')
            and digest(files['manifest.json']) == release.get('mediaManifestSha256')
            and digest(files['deploy.mjs']) == config.get('toolingSha256')
            and files['renderer.sha256'].decode().strip() == config.get('rendererSha256'),
            'Release content checksum mismatch')
    return files


def cached(root, commit):
    identity('1', commit)
    path = root / 'tooling/releases' / commit
    require(path.is_dir(), 'Missing retained tooling for ' + commit + '; stage its verified release first')
    directory(path)
    provenance = json.loads(regular(path / 'provenance.json'))
    require(provenance['sourceCommit'] == commit, 'Cached source identity mismatch')
    files = unpack(regular(path / 'artifact.zip'), provenance)
    for name, data in files.items():
        require(regular(path / name) == data, 'Cached release file changed: ' + name)
    return path


def stage(root, run_id, commit, token):
    identity(run_id, commit)
    target = root / 'tooling/releases' / commit
    if target.exists() or target.is_symlink():
        path = cached(root, commit)
        provenance = json.loads(regular(path / 'provenance.json'))
        require(provenance['runId'] == run_id, 'Cached release belongs to a different verification run')
        return path
    archive, provenance = download(run_id, commit, token)
    files = unpack(archive, provenance)
    directory(target.parent)
    temp = Path(tempfile.mkdtemp(prefix='.stage-', dir=target.parent))
    try:
        for name, data in {**files, 'artifact.zip': archive,
                           'provenance.json': json.dumps(provenance).encode()}.items():
            write(temp / name, data)
        sync(temp)
        temp.rename(target)
        sync(target.parent)
    finally:
        if temp.exists():
            shutil.rmtree(temp)
    return target


def record(root, name):
    path = root / 'state/production' / (name + '.json')
    directory(path.parent)
    return json.loads(regular(path)) if path.exists() or path.is_symlink() else None


def for_record(root, saved):
    path = cached(root, saved['release']['sourceCommit'])
    require(all(json.loads(regular(path / (name + '.json'))) == saved[name]
                for name in ('release', 'configuration', 'manifest')),
            'Retained artifact differs from the saved deployment record')
    return path


def activate(root, commit):
    target = cached(root, commit)
    tooling = root / 'tooling'
    # One atomic selector keeps the executable and renderer from the same release.
    links = {'active': 'releases/' + commit, 'deploy.mjs': 'active/deploy.mjs',
             'renderer.sha256': 'active/renderer.sha256'}
    for name, destination in links.items():
        link = tooling / name
        if link.is_symlink() and os.readlink(link) == destination:
            continue
        temporary = tooling / (name + '.next')
        require(not temporary.exists() and not temporary.is_symlink(),
                'Interrupted tooling activation; inspect ' + str(temporary))
        temporary.symlink_to(destination)
        temporary.replace(link)
        sync(tooling)
    return target


@contextmanager
def lock(root):
    directory(root)
    directory(root / 'tooling')
    # Older release helpers already exclude **/deploy.lock from backups.
    path = root / 'tooling/deploy.lock'
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        raise ValueError('Bootstrap lock exists; inspect active or interrupted operations before retrying') from None
    sync(path.parent)
    try:
        yield
    finally:
        path.rmdir()
        sync(path.parent)


def settled(root, edge):
    require(not (root / 'state/deploy.lock').exists() and not (edge / 'deploy.lock').exists(),
            'Deployment or backup is active or interrupted; inspect its locks')
    require(not list((root / 'state').glob('pending.json'))
            and not list((root / 'state').glob('*/pending.json')),
            'Unrecovered deployment journal; follow the recovery runbook')


def node_runtime():
    # The operator provisions this runtime with mise and records its absolute
    # executable. Never fall back to PATH, activate a shell, or install at runtime.
    config = json.loads(regular(RUNTIME_CONFIG))
    require(isinstance(config, dict) and set(config) == {'version', 'executable'},
            'Invalid Node runtime configuration')
    version, executable = config['version'], config['executable']
    require(isinstance(version, str) and re.fullmatch(r'24\.\d+\.\d+', version),
            'Provision an exact Node 24 version: docs/operations/node-runtime.md')
    require(isinstance(executable, str) and Path(executable).is_absolute(),
            'Expected an absolute Node executable')
    node = Path(executable).resolve(strict=True)
    environment = dict(os.environ)
    # Keep deployment/backup credentials, but do not inherit Node code injection
    # or a different runtime for child processes.
    for name in ('NODE_OPTIONS', 'NODE_PATH'):
        environment.pop(name, None)
    environment['PATH'] = str(node.parent) + os.pathsep + os.defpath + ':/usr/local/bin'
    result = subprocess.run([str(node), '--version'], stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, env=environment, timeout=15, check=False)
    require(result.returncode == 0 and result.stdout.strip() == 'v' + version,
            'Installed Node does not match the runtime pin: docs/operations/node-runtime.md')
    return node, environment


def invoke(root, edge, tool, command, runtime, bundle=None):
    node, environment = runtime
    arguments = [str(node), str(tool), command, '--root', str(root), '--edge-directory', str(edge)]
    if command == 'deploy':
        container = regular(root / 'edge-container').decode().strip()
        require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]+', container), 'Invalid edge container')
        arguments += ['--bundle', str(bundle), '--edge-container', container]
    # stdin never reaches release code: it carried the temporary GitHub token.
    return subprocess.run(arguments, stdin=subprocess.DEVNULL, env=environment, check=False).returncode


def operate(root, edge, command, arguments, token=''):
    with lock(root):
        settled(root, edge)
        if command == 'stage':
            run_id, commit = arguments
            return stage(root, run_id, commit, token)
        if command == 'check':
            return cached(root, arguments[0])
        # Fail before downloading or activating tooling, including offline backup
        # and rollback. Read-only staging and cache checks do not need Node.
        runtime = node_runtime()
        current = record(root, 'current')
        if command == 'backup':
            require(current, 'No current production release to back up')
            commit = current['release']['sourceCommit']
            if (root / 'tooling/releases' / commit).exists():
                for_record(root, current)
                tool = activate(root, commit) / 'deploy.mjs'
            else:
                # Before the first bootstrap promotion, keep the installed,
                # operator-trusted helper usable by the existing backup timer.
                tool = root / 'tooling/deploy.mjs'
                require(digest(regular(tool)) == current['configuration']['toolingSha256'],
                        'Installed legacy backup tooling does not match the current release')
            return invoke(root, edge, tool, 'backup', runtime)
        require((root / 'production-enabled').is_file(), 'Production is not enabled')
        require(json.loads(regular(root / 'profile.json')).get('environment') == 'production',
                'Host profile must select production')
        if command == 'promote':
            transfer, run_id, commit = arguments
            require(re.fullmatch(r'[1-9][0-9]*-[1-9][0-9]*', transfer), 'Invalid transfer ID')
            directory(root / 'incoming')
            incoming = root / 'incoming' / transfer
            incoming.mkdir(mode=0o700)  # Never reuse a failed attempt directory.
            write(incoming / 'request.json', json.dumps({'runId': run_id, 'sourceCommit': commit}).encode())
            candidate = stage(root, run_id, commit, token)
            if current:
                prior = current['release']
                prior_run = prior['verifyRunUrl'].rsplit('/', 1)[-1]
                # Retain rollback tooling before changing either tooling or app.
                stage(root, prior_run, prior['sourceCommit'], token)
            for name in ('release.json', 'manifest.json', 'configuration.json'):
                write(incoming / name, regular(candidate / name))
            sync(incoming)
        else:
            previous = record(root, 'previous')
            require(previous, 'No previous production release to roll back to')
            commit = previous['release']['sourceCommit']
            incoming = for_record(root, previous)
        if current:
            for_record(root, current)
        candidate = activate(root, commit)
        try:
            result = invoke(root, edge, candidate / 'deploy.mjs', 'deploy', runtime, incoming)
        finally:
            # Successful deploys and handled failures leave an authoritative
            # current record. An interrupted transaction requires manual recovery.
            if not (root / 'state/production/pending.json').exists():
                active = record(root, 'current')
                if active:
                    for_record(root, active)
                    activate(root, active['release']['sourceCommit'])
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/srv/nurevolution'))
    parser.add_argument('--edge-directory', type=Path, default=Path('/srv/edge/config'))
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('version')
    commands.add_parser('runtime')
    for name in ('backup', 'rollback'):
        commands.add_parser(name)
    commands.add_parser('check').add_argument('commit')
    for name in ('stage', 'promote'):
        sub = commands.add_parser(name)
        if name == 'promote':
            sub.add_argument('transfer')
        sub.add_argument('run_id')
        sub.add_argument('commit')
    args = parser.parse_args()
    if args.command == 'version':
        print('nurevolution-deploy 3')
        return 0
    if args.command == 'runtime':
        node, _ = node_runtime()
        print(node)
        return 0
    arguments = [getattr(args, field) for field in ('transfer', 'run_id', 'commit') if hasattr(args, field)]
    token = sys.stdin.read(4097).strip() if args.command in ('stage', 'promote') else ''
    result = operate(args.root, args.edge_directory, args.command, arguments, token)
    if isinstance(result, Path):
        print(result)
        return 0
    return result


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.TimeoutExpired, zipfile.BadZipFile) as error:
        print('Release bootstrap failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
