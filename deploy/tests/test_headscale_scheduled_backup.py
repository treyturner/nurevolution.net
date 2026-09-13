from pathlib import Path
import os
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / 'headscale/scheduled-backup.sh'


class ScheduledBackupTests(unittest.TestCase):
    def exercise(self, backup_status, response='{"id":"123"}', webhook=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'backup.sh').write_text(f'exit {backup_status}\n')
            if webhook:
                secret = root / 'discord-webhook'
                secret.write_text('https://discord.com/api/webhooks/123/private-token\n')
                secret.chmod(0o600)
            curl = root / 'curl'
            curl.write_text('#!/bin/bash\ncat > "$HS_BACKUP_ROOT/request"\nprintf "%s\\n" "$@" > "$HS_BACKUP_ROOT/arguments"\nprintf "%s" "$MOCK_RESPONSE"\n')
            curl.chmod(0o700)
            result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env={
                **os.environ, 'HS_BACKUP_ROOT': directory, 'MOCK_RESPONSE': response,
                'PATH': directory + ':' + os.environ['PATH'],
            })
            called = (root / 'request').exists()
            if called:
                self.assertNotIn('private-token', (root / 'arguments').read_text())
                self.assertIn('private-token', (root / 'request').read_text())
            self.assertNotIn('private-token', result.stdout + result.stderr)
            return result, called

    def test_success_sends_nothing(self):
        result, called = self.exercise(0)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(called)

    def test_failure_alert_preserves_backup_exit_status(self):
        result, called = self.exercise(42)
        self.assertEqual(result.returncode, 42)
        self.assertTrue(called)
        self.assertIn('confirmed the Headscale', result.stderr)

    def test_unconfirmed_delivery_still_fails(self):
        result, called = self.exercise(42, '{}')
        self.assertEqual(result.returncode, 42)
        self.assertTrue(called)
        self.assertIn('did not confirm', result.stderr)

    def test_missing_webhook_fails_before_backup(self):
        result, called = self.exercise(0, webhook=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(called)
