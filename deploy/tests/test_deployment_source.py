import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch


PATH = Path(__file__).resolve().parents[2] / '.github/scripts/deployment_source.py'
SPEC = importlib.util.spec_from_file_location('deployment_source', PATH)
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)


class DeploymentSource(unittest.TestCase):
    def setUp(self):
        self.commit = 'a' * 40
        self.run = {
            'id': 123, 'event': 'push', 'status': 'completed', 'conclusion': 'success',
            'head_branch': 'main', 'head_sha': self.commit,
            'path': '.github/workflows/verify.yml',
            'repository': {'full_name': source.REPOSITORY},
            'head_repository': {'full_name': source.REPOSITORY},
        }
        self.event = {'action': 'completed', 'workflow_run': copy.deepcopy(self.run)}
        self.jobs = [{'jobs': [{'name': 'publish', 'conclusion': 'success'}]}]
        self.artifacts = [{'artifacts': [{'name': 'release-' + self.commit, 'expired': False}]}]
        self.main = self.commit

        def response(path, paginate=False):
            if path == 'actions/runs/123':
                return self.run
            if path == 'actions/runs/123/jobs?per_page=100':
                self.assertTrue(paginate)
                return self.jobs
            if path == 'actions/runs/123/artifacts?per_page=100':
                self.assertTrue(paginate)
                return self.artifacts
            if path == 'git/ref/heads/main':
                return {'object': {'sha': self.main}}
            self.fail('Unexpected API path: ' + path)

        self.request = Mock(side_effect=response)

    def select(self, event_name='workflow_run', event=None, **overrides):
        return source.select_source(event_name, self.event if event is None else event,
                                    overrides.get('repository', source.REPOSITORY),
                                    overrides.get('ref', 'refs/heads/main'), self.request)

    def manual(self):
        return self.select('workflow_dispatch', {'inputs': {
            'verify_run_id': '123', 'source_commit': self.commit,
        }})

    def test_successful_published_main_run_selects_its_exact_artifact_identity(self):
        self.assertEqual(self.select(), {'verify_run_id': '123', 'source_commit': self.commit})

    def test_unsuccessful_pr_fork_and_non_main_events_never_read_artifacts(self):
        for key, value in [('event', 'pull_request'), ('head_branch', 'feature'),
                           ('conclusion', 'failure'), ('conclusion', 'cancelled'),
                           ('head_repository', {'full_name': 'someone/fork'})]:
            with self.subTest(key=key, value=value):
                event = copy.deepcopy(self.event)
                event['workflow_run'][key] = value
                self.assertIsNone(self.select(event=event))
        self.assertIsNone(self.select(event={**self.event, 'action': 'requested'}))
        self.request.assert_not_called()

    def test_repository_branch_and_event_boundaries_are_enforced(self):
        for override in [{'repository': 'someone/fork'}, {'ref': 'refs/heads/feature'}]:
            with self.assertRaisesRegex(ValueError, 'production repository on main'):
                self.select(**override)
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            self.select('push')
        self.request.assert_not_called()

    def test_api_provenance_is_verified_independently_of_the_event(self):
        original = copy.deepcopy(self.run)
        for key, value in [('id', 124), ('event', 'pull_request'), ('status', 'in_progress'),
                           ('conclusion', 'failure'), ('head_branch', 'feature'),
                           ('head_sha', 'b' * 40), ('path', '.github/workflows/other.yml'),
                           ('repository', {'full_name': 'someone/fork'}),
                           ('head_repository', {'full_name': 'someone/fork'})]:
            with self.subTest(key=key):
                self.run = {**original, key: value}
                with self.assertRaisesRegex(ValueError, 'successful main Verify'):
                    self.select()

    def test_docs_only_runs_skip_without_downloading_or_promoting(self):
        self.jobs[0]['jobs'][0]['conclusion'] = 'skipped'
        self.assertIsNone(self.select())
        self.assertEqual(self.request.call_count, 2)
        with self.assertRaisesRegex(ValueError, 'publish'):
            self.manual()

    def test_missing_failed_or_duplicate_publication_is_an_error(self):
        for jobs in [[], [{'name': 'publish', 'conclusion': 'failure'}],
                     [{'name': 'publish', 'conclusion': 'success'}] * 2]:
            self.jobs = [{'jobs': jobs}]
            with self.assertRaisesRegex(ValueError, 'publish'):
                self.select()

    def test_missing_expired_and_duplicate_artifacts_are_errors(self):
        artifact = self.artifacts[0]['artifacts'][0]
        for artifacts in [[], [{**artifact, 'expired': True}], [artifact, artifact],
                          [{**artifact, 'name': 'release-' + 'b' * 40}]]:
            self.artifacts = [{'artifacts': artifacts}]
            with self.assertRaisesRegex(ValueError, 'nonexpired release artifact'):
                self.select()

    def test_job_and_artifact_selection_includes_later_pages(self):
        self.jobs.insert(0, {'jobs': [{'name': 'verify', 'conclusion': 'success'}]})
        self.artifacts.insert(0, {'artifacts': [{'name': 'verification-reports'}]})
        self.assertIsNotNone(self.select())
        self.artifacts.append(self.artifacts[-1])
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.select()

    def test_newer_main_commit_blocks_automatic_reruns_and_queued_releases(self):
        self.assertIsNotNone(self.select())
        self.main = 'b' * 40
        self.assertIsNone(self.select())
        # A deliberate manual promotion may select an older verified release.
        self.assertEqual(self.manual()['source_commit'], self.commit)

    def test_inputs_are_validated_before_api_access(self):
        for run_id, commit in [('0', self.commit), ('123;echo bad', self.commit),
                               ('123', 'main'), ('123', self.commit + '\n')]:
            with self.assertRaisesRegex(ValueError, 'Invalid verification'):
                self.select('workflow_dispatch', {'inputs': {
                    'verify_run_id': run_id, 'source_commit': commit,
                }})
        self.request.assert_not_called()

    def test_api_failures_do_not_become_successful_skips(self):
        self.request.side_effect = RuntimeError('API unavailable')
        with self.assertRaisesRegex(RuntimeError, 'API unavailable'):
            self.select()

    def test_api_decodes_each_page_and_rejects_malformed_responses(self):
        pages = [{'jobs': [{'name': 'verify'}]}, {'jobs': [{'name': 'publish'}]}]
        response = '\n'.join(json.dumps(page, indent=2) for page in pages) + '\n'
        with patch.object(source.subprocess, 'check_output', return_value=response) as command:
            self.assertEqual(source.api('actions/runs/123/jobs', True), pages)
            self.assertIn('--paginate', command.call_args.args[0])
        with patch.object(source.subprocess, 'check_output', return_value=json.dumps(self.run)):
            self.assertEqual(source.api('actions/runs/123'), self.run)
        with patch.object(source.subprocess, 'check_output', return_value=response + 'invalid'):
            with self.assertRaises(json.JSONDecodeError):
                source.api('actions/runs/123/jobs', True)

    def test_workflow_outputs_are_written_for_selection_and_skip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            event = root / 'event.json'
            event.write_text(json.dumps(self.event))
            output = root / 'output'
            env = {'GITHUB_EVENT_PATH': str(event), 'GITHUB_OUTPUT': str(output),
                   'GITHUB_EVENT_NAME': 'workflow_run', 'GITHUB_REF': 'refs/heads/main',
                   'GITHUB_REPOSITORY': source.REPOSITORY}
            for result in [None, {'verify_run_id': '123', 'source_commit': self.commit}]:
                output.write_text('')
                with patch.dict(os.environ, env), patch.object(source, 'select_source', return_value=result):
                    source.main()
                self.assertEqual(output.read_text().splitlines(),
                                 ['ready=false'] if result is None else [
                                     'ready=true', 'verify_run_id=123', 'source_commit=' + self.commit])


if __name__ == '__main__':
    unittest.main()
