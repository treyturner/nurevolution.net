import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('uptime', Path(__file__).parents[1] / 'uptime.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class UptimeTests(unittest.TestCase):
    def test_incident_and_recovery_once(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(monitor, 'notify') as notify:
            path = Path(directory) / 'state.json'
            for previous, failures, calls in [([], [], 0), ([], ['website'], 1),
                    (['website'], ['website'], 1), (['website'], [], 2), ([], [], 2)]:
                self.assertEqual(monitor.run(path, previous, failures), int(bool(failures)))
                self.assertEqual(notify.call_count, calls)
                self.assertEqual(json.loads(path.read_text())['alertedFailures'], failures)

    def test_unconfirmed_alert_is_retried_next_run(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(monitor, 'notify', side_effect=ValueError):
            path = Path(directory) / 'state.json'
            with self.assertRaises(ValueError):
                monitor.run(path, [], ['website'])
            self.assertEqual(json.loads(path.read_text())['alertedFailures'], [])

    def test_feed_enclosure_rejects_cross_origin_before_audio_request(self):
        for url in ['http://podcast.nurevolution.net/a.mp3', 'https://127.0.0.1/a',
                    'https://podcast.nurevolution.net@evil.test/a']:
            body = ('<rss><channel>' + (f'<item><enclosure url="{url}" length="10" /></item>' * 55)
                    + '</channel></rss>').encode()
            with patch.object(monitor, 'fetch', return_value=(200, {}, body)) as fetch:
                with self.assertRaises(ValueError):
                    monitor.feed_and_audio()
                self.assertEqual(fetch.call_count, 1)

    def test_ignored_or_wrong_audio_range_fails(self):
        body = ('<rss><channel>' + ('<item><enclosure url="https://podcast.nurevolution.net/a.mp3" length="10" /></item>' * 55) + '</channel></rss>').encode()
        for response in [(200, {}, b'x'), (206, {'Content-Range': 'bytes 0-0/11', 'Content-Type': 'audio/mpeg'}, b'x')]:
            with patch.object(monitor, 'fetch', side_effect=[(200, {}, body), response]):
                with self.assertRaises(ValueError):
                    monitor.feed_and_audio()
        with patch.object(monitor, 'fetch', side_effect=[(200, {}, body), (206, {'Content-Range': 'bytes 0-0/10', 'Content-Type': 'audio/mpeg'}, b'x')]):
            monitor.feed_and_audio()

    def test_second_attempt_recovers_transient_failure(self):
        with patch.object(monitor, 'page', side_effect=[ValueError('secret'), None]), patch.object(monitor, 'health'), patch.object(monitor, 'feed_and_audio'), patch.object(monitor, 'certificate'), patch.object(monitor.time, 'sleep'):
            self.assertEqual(monitor.probe(), [])

    def test_failures_contain_only_fixed_labels(self):
        with patch.object(monitor, 'page', side_effect=ValueError('secret')), patch.object(monitor, 'health'), patch.object(monitor, 'feed_and_audio'), patch.object(monitor, 'certificate'), patch.object(monitor.time, 'sleep'):
            self.assertEqual(monitor.probe(), ['website'])

    def test_no_redirects(self):
        with self.assertRaises(ValueError):
            monitor.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test')

    def test_previous_state_skips_untrusted_runs_and_restores_confirmed_incident(self):
        import io
        import zipfile
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z:
            z.writestr('state.json', json.dumps({'schemaVersion': 1, 'alertedFailures': ['website']}))
        base = {'id': 1, 'path': monitor.WORKFLOW, 'head_branch': 'main', 'event': 'schedule', 'repository': {'full_name': monitor.REPOSITORY}}
        runs = [{**base, 'id': 2, 'event': 'pull_request'}, base]
        with patch.object(monitor, 'api', side_effect=[{'workflow_runs': runs}, {'artifacts': [{'id': 42, 'name': 'uptime-state', 'expired': False, 'size_in_bytes': len(archive.getvalue())}]}, archive.getvalue()]) as api:
            self.assertEqual(monitor.previous_state(), ['website'])
            self.assertEqual(api.call_args_list[1].args, ('actions/runs/1/artifacts',))

    def test_missing_state_starts_with_quiet_healthy_baseline(self):
        with patch.object(monitor, 'api', return_value={'workflow_runs': []}):
            self.assertEqual(monitor.previous_state(), [])

    def test_transport_rejects_oversized_response(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'xx'
        with patch.object(monitor.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            with self.assertRaisesRegex(ValueError, 'too large'):
                monitor.fetch(monitor.MEDIA + '/a.mp3', 1)
            response.read.assert_called_once_with(2)

    def test_missing_secret_is_an_error_even_for_healthy_site(self):
        with patch.dict(monitor.os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'missing or invalid'):
                monitor.webhook()
