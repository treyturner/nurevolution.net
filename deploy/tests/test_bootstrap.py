import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import urllib.error
import zipfile


SPEC = importlib.util.spec_from_file_location('bootstrap', Path(__file__).parents[1] / 'bootstrap.py')
b = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(b)


def encode(value):
    return json.dumps(value).encode()


def release(commit, run, outcome='success'):
    # Real Node execution checks both paths, reproducing the stale-helper failure.
    tool = (f'// Release {commit}, outcome {outcome}\n' + r'''
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args = process.argv;
const root = args[args.indexOf('--root') + 1];
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const state = root + '/state/production/';
const backup = args[2] === 'backup';
const bundle = args[args.indexOf('--bundle') + 1];
const current = fs.existsSync(state + 'current.json') ? JSON.parse(fs.readFileSync(state + 'current.json')) : null;
const candidate = backup ? current : Object.fromEntries(['release', 'configuration', 'manifest'].map(name => [name, JSON.parse(fs.readFileSync(bundle + '/' + name + '.json'))]));
if (hash(root + '/tooling/deploy.mjs') !== candidate.configuration.toolingSha256 || hash(fileURLToPath(import.meta.url)) !== candidate.configuration.toolingSha256) throw Error('Deployment tooling checksum mismatch');
if (fs.readFileSync(root + '/tooling/renderer.sha256', 'utf8').trim() !== candidate.configuration.rendererSha256) throw Error('Renderer mismatch');
if (fs.readFileSync(0).length) throw Error('Token leaked to release code');
fs.appendFileSync(root + '/executed', candidate.release.sourceCommit + '\n');
if (backup) process.exit(0);
''' + ({'failure': 'process.exit(12);',
        'pending': "fs.writeFileSync(state + 'pending.json', '{}'); process.exit(17);"}.get(outcome, '')
           or "if (current) fs.writeFileSync(state + 'previous.json', JSON.stringify(current));\n"
           "fs.writeFileSync(state + 'current.json', JSON.stringify(candidate));")).encode()
    # Dependency-only updates change tool bytes while the renderer stays fixed.
    renderer = b.digest(b'stable-renderer')
    files = {'deploy.mjs': tool, 'renderer.sha256': (renderer + '\n').encode(),
             'configuration.json': encode({'sourceCommit': commit, 'toolingSha256': b.digest(tool),
                                          'rendererSha256': renderer}),
             'manifest.json': encode({'sourceCommit': commit}), 'delivery-evidence.json': b'{}'}
    files['release.json'] = encode({'sourceCommit': commit,
                                   'verifyRunUrl': f'https://github.com/{b.REPOSITORY}/actions/runs/{run}',
                                   'configurationSha256': b.digest(files['configuration.json']),
                                   'mediaManifestSha256': b.digest(files['manifest.json'])})
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    archive = output.getvalue()
    proof = {'runId': run, 'sourceCommit': commit, 'artifactId': int(run), 'archiveSha256': b.digest(archive)}
    return archive, proof, files


class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime_config = self.root / 'node-runtime.json'
        self.node = str(Path(shutil.which('node')).resolve())
        self.version = (Path(__file__).parents[2] / '.node-version').read_text().strip()
        self.runtime_config.write_bytes(encode({'version': self.version, 'executable': self.node}))
        patch.object(b, 'RUNTIME_CONFIG', self.runtime_config).start()
        self.addCleanup(patch.stopall)
        self.edge = self.root / 'edge'
        self.edge.mkdir()
        (self.root / 'profile.json').write_text('{"environment":"production"}')
        (self.root / 'production-enabled').touch()
        (self.root / 'edge-container').write_text('test-edge')
        (self.root / 'state/production').mkdir(parents=True)
        (self.root / 'tooling').mkdir()
        self.old = release('a' * 40, '101')
        self.new = release('b' * 40, '202')
        self.failed = release('c' * 40, '303', 'failure')
        self.pending = release('d' * 40, '404', 'pending')
        self.releases = {item[1]['sourceCommit']: item for item in
                         (self.old, self.new, self.failed, self.pending)}
        files = self.old[2]
        for name in ('deploy.mjs', 'renderer.sha256'):
            (self.root / 'tooling' / name).write_bytes(files[name])
        self.save_record('current', self.old)
        self.downloader = patch.object(b, 'download', side_effect=self.download).start()
        self.addCleanup(patch.stopall)

    def download(self, run, commit, token):
        item = self.releases[commit]
        self.assertEqual(run, item[1]['runId'])
        self.assertEqual(token, 'temporary-token')
        return item[:2]

    def save_record(self, name, item):
        value = {key: json.loads(item[2][key + '.json']) for key in ('release', 'configuration', 'manifest')}
        (self.root / 'state/production' / (name + '.json')).write_bytes(encode(value))

    def operate(self, command, arguments=()):
        return b.operate(self.root, self.edge, command, arguments, 'temporary-token')

    def promote(self, item, attempt='900-1'):
        return self.operate('promote', [attempt, item[1]['runId'], item[1]['sourceCommit']])

    def assert_active(self, item):
        self.assertEqual((self.root / 'tooling/deploy.mjs').read_bytes(), item[2]['deploy.mjs'])
        self.assertEqual((self.root / 'tooling/renderer.sha256').read_bytes(), item[2]['renderer.sha256'])

    def test_upgrade_preserves_old_tools_and_offline_rollback_uses_matching_executable(self):
        self.assertEqual(self.promote(self.new), 0)
        self.assert_active(self.new)
        self.assertEqual(self.downloader.call_count, 2)
        self.downloader.side_effect = AssertionError('Rollback must work offline')
        self.assertEqual(self.operate('rollback'), 0)
        self.assert_active(self.old)
        self.assertEqual((self.root / 'executed').read_text().splitlines(), ['b' * 40, 'a' * 40])
        self.assertTrue(b.cached(self.root, 'b' * 40).is_dir())

    def test_runtime_ignores_path_node_and_node_options_but_preserves_backup_environment(self):
        fake_bin = self.root / 'bin'
        fake_bin.mkdir()
        (fake_bin / 'node').write_text('#!/bin/sh\nexit 99\n')
        (fake_bin / 'node').chmod(0o700)
        with patch.dict(os.environ, {'PATH': str(fake_bin), 'NODE_OPTIONS': '--require=/nonexistent',
                                     'NODE_PATH': '/nonexistent', 'RESTIC_PASSWORD': 'test-only'}):
            node, environment = b.node_runtime()
            self.assertEqual(str(node), self.node)
            # Both direct and child Node execution use the selected runtime.
            result = subprocess.run([str(node), '-e',
                                     "const c = require('node:child_process'); "
                                     "console.log(c.execFileSync('node', ['--version'], {encoding: 'utf8'}).trim()); "
                                     "if (process.env.RESTIC_PASSWORD !== 'test-only') process.exit(2)"],
                                    env=environment, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'v' + self.version)
            self.assertNotIn('NODE_OPTIONS', environment)
            self.assertNotIn('NODE_PATH', environment)
            self.assertEqual(self.operate('backup'), 0)

    def test_bad_runtime_stops_every_executing_entrypoint_before_changes(self):
        for config in ({'version': '22.23.2', 'executable': self.node},
                       {'version': self.version, 'executable': 'node'},
                       {'version': self.version, 'executable': str(self.root / 'missing-node')},
                       {'version': '24.0.0', 'executable': self.node}):
            self.runtime_config.write_bytes(encode(config))
            for command, args in [('promote', ['900-1', '202', 'b' * 40]),
                                  ('backup', []), ('rollback', [])]:
                with self.subTest(config=config, command=command):
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        self.operate(command, args)
                    self.assert_active(self.old)
                    self.assertFalse((self.root / 'incoming').exists())
                    self.assertFalse((self.root / 'executed').exists())
                    self.assertFalse((self.root / 'tooling/deploy.lock').exists())
                    self.downloader.assert_not_called()

    def test_staging_and_cache_check_do_not_require_a_runtime(self):
        self.runtime_config.unlink()
        self.operate('stage', ['202', 'b' * 40])
        self.assertTrue(self.operate('check', ['b' * 40]).is_dir())
        with self.assertRaises(FileNotFoundError):
            self.operate('backup')

    def test_development_and_bundle_runtime_pins_agree(self):
        repo = Path(__file__).parents[2]
        mise = tomllib.loads((repo / 'mise.toml').read_text())
        package = json.loads((repo / 'package.json').read_text())
        self.assertEqual(mise['tools']['node'], self.version)
        self.assertEqual(package['engines']['node'], self.version)
        self.assertIn('--target=node' + self.version.split('.')[0] + ' ', package['scripts']['build:deploy'])

    def test_failed_upgrade_restores_tooling_and_attempt_retry_keeps_evidence(self):
        self.assertEqual(self.promote(self.failed), 12)
        self.assert_active(self.old)
        self.assertEqual(self.promote(self.new, '900-2'), 0)
        self.assert_active(self.new)
        self.assertEqual(json.loads((self.root / 'incoming/900-1/release.json').read_bytes())['sourceCommit'], 'c' * 40)
        with self.assertRaises(FileExistsError):
            self.promote(self.new, '900-1')

    def test_interrupted_transaction_keeps_candidate_and_requires_recovery(self):
        self.assertEqual(self.promote(self.pending), 17)
        self.assert_active(self.pending)
        for command, args in [('promote', ['900-2', '202', 'b' * 40]), ('backup', []), ('rollback', [])]:
            with self.subTest(command=command), self.assertRaisesRegex(ValueError, 'journal'):
                self.operate(command, args)
        self.assertFalse((self.root / 'tooling/deploy.lock').exists())

    def test_missing_prior_artifact_stops_before_activation_or_execution(self):
        def only_candidate(run, commit, token):
            if run == '202':
                return self.new[:2]
            raise ValueError('Expired artifact')
        self.downloader.side_effect = only_candidate
        with self.assertRaisesRegex(ValueError, 'Expired'):
            self.promote(self.new)
        self.assert_active(self.old)
        self.assertFalse((self.root / 'executed').exists())

    def test_backup_works_before_and_after_migration_without_github(self):
        self.assertEqual(self.operate('backup'), 0)
        self.downloader.assert_not_called()
        self.assertEqual(self.promote(self.new), 0)
        self.downloader.side_effect = AssertionError('Backups must work offline')
        self.assertEqual(self.operate('backup'), 0)
        self.assert_active(self.new)

    def test_all_entrypoints_refuse_concurrent_or_interrupted_locks(self):
        for lock in ('tooling/deploy.lock', 'state/deploy.lock', 'edge/deploy.lock'):
            for command, args in [('promote', ['900-1', '202', 'b' * 40]), ('backup', []), ('rollback', [])]:
                with self.subTest(lock=lock, command=command):
                    path = self.root / lock
                    path.mkdir()
                    try:
                        with self.assertRaisesRegex(ValueError, '[Ll]ock'):
                            self.operate(command, args)
                    finally:
                        path.rmdir()
        self.assertFalse((self.root / 'executed').exists())

    def test_cache_rejects_changed_executable_archive_and_symlinks(self):
        target = self.operate('stage', ['202', 'b' * 40])
        for name in ('deploy.mjs', 'artifact.zip', 'renderer.sha256', 'release.json'):
            with self.subTest(name=name):
                path = target / name
                original = path.read_bytes()
                path.write_bytes(original + b'\n')
                with self.assertRaisesRegex(ValueError, 'checksum|changed'):
                    self.operate('check', ['b' * 40])
                path.write_bytes(original)
        path = target / 'deploy.mjs'
        path.unlink()
        path.symlink_to(self.root / 'tooling/deploy.mjs')
        with self.assertRaisesRegex(ValueError, 'regular'):
            self.operate('check', ['b' * 40])

    def test_same_commit_cannot_reuse_a_different_run_or_symlinked_cache(self):
        target = self.operate('stage', ['202', 'b' * 40])
        with self.assertRaisesRegex(ValueError, 'different verification run'):
            self.operate('stage', ['203', 'b' * 40])
        moved = target.with_name('moved')
        target.rename(moved)
        target.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.operate('check', ['b' * 40])

    def test_retained_artifact_must_match_saved_record_not_just_its_commit(self):
        path = self.root / 'state/production/current.json'
        saved = json.loads(path.read_bytes())
        saved['configuration']['toolingSha256'] = '0' * 64
        path.write_bytes(encode(saved))
        with self.assertRaisesRegex(ValueError, 'differs from the saved'):
            self.promote(self.new)
        self.assert_active(self.old)
        self.assertFalse((self.root / 'executed').exists())

    def test_first_deployment_and_marker_guards(self):
        (self.root / 'production-enabled').unlink()
        with self.assertRaisesRegex(ValueError, 'not enabled'):
            self.promote(self.new)
        (self.root / 'production-enabled').touch()
        (self.root / 'profile.json').write_text('{"environment":"staging"}')
        with self.assertRaisesRegex(ValueError, 'production'):
            self.promote(self.new)
        (self.root / 'profile.json').write_text('{"environment":"production"}')
        (self.root / 'state/production/current.json').unlink()
        self.assertEqual(self.promote(self.new), 0)
        self.assert_active(self.new)


class ArtifactTrust(unittest.TestCase):
    def setUp(self):
        self.archive, self.proof, self.files = release('a' * 40, '101')
        self.run = {'event': 'push', 'conclusion': 'success', 'head_branch': 'main',
                    'head_sha': 'a' * 40, 'path': '.github/workflows/verify.yml',
                    'repository': {'full_name': b.REPOSITORY, 'id': 123},
                    'head_repository': {'full_name': b.REPOSITORY}}
        self.artifact = {'id': 456, 'name': 'release-' + 'a' * 40, 'expired': False,
                         'size_in_bytes': len(self.archive), 'digest': 'sha256:' + b.digest(self.archive),
                         'workflow_run': {'id': 101, 'head_sha': 'a' * 40, 'head_branch': 'main',
                                          'repository_id': 123, 'head_repository_id': 123}}

    def fetch(self, run=None, artifacts=None, archive=None):
        with patch.object(b, 'request', side_effect=[encode(run or self.run),
                                                   encode({'artifacts': artifacts if artifacts is not None else [self.artifact]}),
                                                   archive or self.archive]):
            return b.download('101', 'a' * 40, 'temporary-token')

    def test_accepts_only_successful_trusted_main_run(self):
        archive, proof = self.fetch()
        self.assertEqual(b.unpack(archive, proof), self.files)
        for key, value in [('event', 'pull_request'), ('conclusion', 'failure'), ('head_branch', 'feature'),
                           ('head_sha', 'b' * 40), ('path', '.github/workflows/other.yml'),
                           ('repository', {'full_name': 'other/repo', 'id': 123}),
                           ('head_repository', {'full_name': 'fork/repo'})]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'successful main'):
                self.fetch(run={**self.run, key: value})

    def test_rejects_missing_expired_mismatched_and_changed_artifacts(self):
        for artifacts in ([], [self.artifact, self.artifact], [{**self.artifact, 'expired': True}],
                          [{**self.artifact, 'size_in_bytes': b.LIMIT + 1}],
                          [{**self.artifact, 'digest': None}]):
            with self.subTest(artifacts=artifacts), self.assertRaises(ValueError):
                self.fetch(artifacts=artifacts)
        for key, value in [('id', 102), ('head_sha', 'b' * 40), ('head_branch', 'feature'),
                           ('repository_id', 9), ('head_repository_id', 9)]:
            artifact = copy.deepcopy(self.artifact)
            artifact['workflow_run'][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'mismatched'):
                self.fetch(artifacts=[artifact])
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.fetch(archive=self.archive + b'changed')

    def test_untrusted_archive_entries_and_content_are_never_extracted(self):
        variants = [{**self.files, '../escape': b'bad'}, {**self.files, 'deploy.mjs': b'bad'},
                    {**self.files, 'release.json': encode({'sourceCommit': 'b' * 40})}]
        for files in variants:
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as zipped:
                for name, data in files.items():
                    zipped.writestr(name, data)
            archive = output.getvalue()
            with self.assertRaises(ValueError):
                b.unpack(archive, {**self.proof, 'archiveSha256': b.digest(archive)})

    def test_archive_symlinks_are_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as zipped:
            for name, data in self.files.items():
                entry = zipfile.ZipInfo(name)
                entry.external_attr = (0o120777 if name == 'deploy.mjs' else 0o100600) << 16
                zipped.writestr(entry, data)
        archive = output.getvalue()
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            b.unpack(archive, {**self.proof, 'archiveSha256': b.digest(archive)})

    def test_download_redirect_never_receives_api_token(self):
        api = b.API + '/actions/artifacts/456/zip'
        storage = 'https://storage.example.test/signed-artifact'
        redirect = urllib.error.HTTPError(api, 302, 'Found', {'Location': storage}, None)
        with patch.object(b.urllib.request, 'build_opener') as factory:
            opener = factory.return_value
            opener.open.side_effect = [redirect, io.BytesIO(b'archive')]
            self.assertEqual(b.request(api, 'temporary-token'), b'archive')
            first, second = [call.args[0] for call in opener.open.call_args_list]
            self.assertEqual(first.get_header('Authorization'), 'Bearer temporary-token')
            self.assertIsNone(second.get_header('Authorization'))
            self.assertEqual(second.full_url, storage)
        with self.assertRaisesRegex(ValueError, 'restricted'):
            b.request('https://example.test/', 'temporary-token')
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            b.request('http://example.test/')


if __name__ == '__main__':
    unittest.main()
