import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'headscale_runner', Path(__file__).resolve().parents[1] / 'headscale/runner.py'
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class HeadscaleRunner(unittest.TestCase):
    def test_rejects_shared_directory_and_directory_symlink(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'RUNNER_TEMP': temp}):
            directory = Path(temp) / 'headscale'
            directory.mkdir(mode=0o755)
            with self.assertRaises(ValueError):
                runner.private_directory()
            directory.chmod(0o700)
            directory.rename(Path(temp) / 'elsewhere')
            directory.symlink_to(Path(temp) / 'elsewhere')
            with self.assertRaises(ValueError):
                runner.private_directory()

    def test_bad_checksum_never_extracts_or_executes_and_removes_credential(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            auth = directory / 'auth.key'
            auth.write_text('fixture-private-enrollment-key')
            auth.chmod(0o600)
            with patch.dict(os.environ, {'HEADSCALE_URL': 'https://control.example',
                                         'HEADSCALE_HOSTNAME': 'test-runner'}), \
                    patch.object(runner.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt archive')), \
                    patch.object(runner.subprocess, 'Popen') as daemon, \
                    patch.object(runner.tarfile, 'open') as extract:
                with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                    runner.start(directory)
                daemon.assert_not_called()
                extract.assert_not_called()
                self.assertFalse(auth.exists())
            runner.stop(directory)
            self.assertFalse(directory.exists())

    def test_credential_symlink_is_removed_without_reading_or_changing_target(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            original = directory / 'original'
            original.write_text('private-value')
            (directory / 'auth.key').symlink_to(original)
            with patch.object(runner.urllib.request, 'urlopen') as download:
                with self.assertRaisesRegex(ValueError, 'Enrollment file must be private'):
                    runner.start(directory)
                download.assert_not_called()
            self.assertEqual(original.read_text(), 'private-value')
            self.assertFalse((directory / 'auth.key').is_symlink())

    def test_cleanup_refuses_to_signal_an_unrelated_process(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'daemon.pid').write_text(str(os.getpid()))
            with patch.object(runner.os, 'kill') as kill:
                with self.assertRaisesRegex(ValueError, 'outside this runner client'):
                    runner.stop(directory)
                kill.assert_not_called()


if __name__ == '__main__':
    unittest.main()
