import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]


class DeployHelper(unittest.TestCase):
    def test_workflow_attempts_use_distinct_bundles_and_keep_failed_attempt(self):
        workflow = (REPO / '.github/workflows/deploy.yml').read_text()
        template = re.search(r'^\s+TRANSFER_ID: (.+)$', workflow, re.MULTILINE).group(1)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'incoming').mkdir()
            (root / 'tooling').mkdir()
            (root / 'profile.json').write_text('{"environment":"preview"}')
            (root / 'edge-container').write_text('test-edge')
            helper = root / 'helper'
            # Redirect only the fixed site root into this disposable fixture.
            helper.write_text((REPO / 'deploy/nurevolution-deploy').read_text().replace(
                '/srv/nurevolution', str(root)))
            (root / 'tooling/deploy.mjs').write_text('''
import * as fs from 'node:fs';
const bundle = process.argv[process.argv.indexOf('--bundle') + 1];
const value = JSON.parse(fs.readFileSync(bundle + '/release.json'));
console.log(bundle);
if (value.fail) process.exit(1);
''')
            attempts = []
            for attempt in (1, 2):
                transfer = template.replace('${{ github.run_id }}', '12345').replace(
                    '${{ github.run_attempt }}', str(attempt))
                incoming = root / 'incoming' / transfer
                incoming.mkdir(mode=0o700)
                (incoming / 'release.json').write_text(json.dumps({'fail': attempt == 1}))
                result = subprocess.run(['bash', str(helper), 'preview', transfer],
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 1 if attempt == 1 else 0, result.stderr)
                self.assertEqual(result.stdout.strip(), str(incoming))
                attempts.append(incoming)
            self.assertNotEqual(*attempts)
            self.assertTrue(json.loads((attempts[0] / 'release.json').read_text())['fail'])
            for transfer in ('12345', '12345-0', '0-1', '../12345-1', '12345-1;true', ''):
                with self.subTest(transfer=transfer):
                    result = subprocess.run(['bash', str(helper), 'preview', transfer],
                                            capture_output=True, text=True, check=False)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
