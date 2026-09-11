import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest


REPO = Path(__file__).resolve().parents[2]


class DeployHelper(unittest.TestCase):
    def test_workflow_rejects_public_deployment_targets_and_invalid_promotions(self):
        workflow = (REPO / '.github/workflows/deploy.yml').read_text()
        block = re.search(
            r'      - name: Validate promotion inputs and environment readiness\n'
            r'.*?        run: \|\n(.*?)(?=      - )', workflow, re.DOTALL
        ).group(1)
        script = textwrap.dedent(block)
        valid = {
            'RELEASE_COMMIT': 'a' * 40, 'VERIFY_RUN_ID': '12345',
            'TARGET_ENVIRONMENT': 'preview', 'DEPLOYMENT_ENABLED': 'true',
            'CUTOVER_ENABLED': 'false', 'HEADSCALE_URL': 'https://headscale.treyturner.info',
            'DEPLOY_HOST': '100.64.0.1',
        }
        cases = [({}, True), ({'HEADSCALE_URL': valid['HEADSCALE_URL'] + ':443'}, True),
                 ({'TARGET_ENVIRONMENT': 'production', 'CUTOVER_ENABLED': 'true'}, True)]
        cases += [({key: value}, False) for key, value in [
            ('DEPLOY_HOST', '159.89.86.21'), ('DEPLOY_HOST', '192.168.1.1'),
            ('DEPLOY_HOST', '127.0.0.1'), ('DEPLOY_HOST', '100.128.0.1'),
            ('DEPLOY_HOST', 'example.com'), ('DEPLOY_HOST', '::1'),
            ('DEPLOY_HOST', ''), ('HEADSCALE_URL', 'http://headscale.treyturner.info'),
            ('HEADSCALE_URL', valid['HEADSCALE_URL'] + ' --accept-routes'),
            ('HEADSCALE_URL', ''), ('RELEASE_COMMIT', 'main'), ('VERIFY_RUN_ID', '0'),
            ('TARGET_ENVIRONMENT', 'production'), ('TARGET_ENVIRONMENT', 'unknown'),
            ('DEPLOYMENT_ENABLED', 'false'),
        ]]
        for override, accepted in cases:
            with self.subTest(override=override):
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', script],
                                        env={**os.environ, **valid, **override},
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode == 0, accepted, result.stderr)

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
