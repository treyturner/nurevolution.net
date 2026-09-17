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
            'TARGET_ENVIRONMENT': 'production', 'DEPLOYMENT_ENABLED': 'true',
            'CUTOVER_ENABLED': 'true', 'HEADSCALE_URL': 'https://headscale.treyturner.info',
            'DEPLOY_HOST': '100.64.0.1',
        }
        cases = [({}, True), ({'HEADSCALE_URL': valid['HEADSCALE_URL'] + ':443'}, True),
                 ({'TARGET_ENVIRONMENT': 'production'}, True)]
        cases += [({key: value}, False) for key, value in [
            ('DEPLOY_HOST', '159.89.86.21'), ('DEPLOY_HOST', '192.168.1.1'),
            ('DEPLOY_HOST', '127.0.0.1'), ('DEPLOY_HOST', '100.128.0.1'),
            ('DEPLOY_HOST', 'example.com'), ('DEPLOY_HOST', '::1'),
            ('DEPLOY_HOST', ''), ('HEADSCALE_URL', 'http://headscale.treyturner.info'),
            ('HEADSCALE_URL', valid['HEADSCALE_URL'] + ' --accept-routes'),
            ('HEADSCALE_URL', ''), ('RELEASE_COMMIT', 'main'), ('VERIFY_RUN_ID', '0'),
            ('CUTOVER_ENABLED', 'false'), ('TARGET_ENVIRONMENT', 'unknown'),
            ('DEPLOYMENT_ENABLED', 'false'),
        ]]
        for override, accepted in cases:
            with self.subTest(override=override):
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', script],
                                        env={**os.environ, **valid, **override},
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode == 0, accepted, result.stderr)

    def test_wrapper_validates_protocol_arguments_and_keeps_token_on_stdin(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            bootstrap = root / 'bootstrap.py'
            bootstrap.write_text('import json, sys; print(json.dumps(sys.argv[1:])); '
                                 'assert sys.stdin.read() == "temporary-token"')
            helper = root / 'helper'
            helper.write_text((REPO / 'deploy/nurevolution-deploy').read_text().replace(
                '/usr/local/lib/nurevolution/bootstrap.py', str(bootstrap)))
            valid = ['production', '12345-2', '6789', 'a' * 40]
            result = subprocess.run(['bash', str(helper), *valid], input='temporary-token',
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), ['promote', *valid[1:]])
            for index, value in [(0, 'staging'), (1, '12345'), (1, '12345-0'),
                                 (1, '0-1'), (1, '../12345-1'), (1, '12345-1;true'),
                                 (2, '0'), (2, '1;true'), (3, 'main'), (3, 'a' * 39)]:
                with self.subTest(index=index, value=value):
                    arguments = valid.copy()
                    arguments[index] = value
                    result = subprocess.run(['bash', str(helper), *arguments],
                                            capture_output=True, text=True, check=False)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, '')
            version = subprocess.run(['bash', str(helper), '--version'], input='temporary-token',
                                     capture_output=True, text=True, check=False)
            self.assertEqual(json.loads(version.stdout), ['version'])

    def test_workflow_sends_run_commit_and_token_only_after_protocol_check(self):
        workflow = (REPO / '.github/workflows/deploy.yml').read_text()
        block = re.search(
            r'      - name: Promote with independently verified release tooling\n'
            r'.*?        run: \|\n(.*?)(?=      - )', workflow, re.DOTALL
        ).group(1)
        template = re.search(r'^\s+TRANSFER_ID: (.+)$', workflow, re.MULTILINE).group(1)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ssh = root / 'ssh'
            ssh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
command = sys.argv[-1]
if command == 'id -un':
    print('nurevolution-deploy')
elif command == 'nurevolution-deploy --version':
    print(os.environ['TEST_PROTOCOL'])
else:
    pathlib.Path(os.environ['TEST_RECEIPT']).write_text(json.dumps([command, sys.stdin.read()]))
''')
            ssh.chmod(0o700)
            receipt = root / 'receipt'
            environment = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                           'DEPLOY_HOST': '100.64.0.1', 'DEPLOY_USER': 'nurevolution-deploy',
                           'SSH_PRIVATE_KEY': 'dummy', 'SSH_KNOWN_HOSTS': 'dummy',
                           'TARGET_ENVIRONMENT': 'production', 'HEADSCALE_PROXY_COMMAND': 'dummy',
                           'VERIFY_RUN_ID': '6789', 'RELEASE_COMMIT': 'a' * 40,
                           'GH_TOKEN': 'temporary-token', 'RUNNER_TEMP': str(root / 'runner'),
                           'TEST_RECEIPT': str(receipt)}
            for attempt, protocol in [(1, 'nurevolution-deploy 2'), (2, 'nurevolution-deploy 3')]:
                transfer = template.replace('${{ github.run_id }}', '12345').replace(
                    '${{ github.run_attempt }}', str(attempt))
                result = subprocess.run(['bash', '-euo', 'pipefail', '-c', textwrap.dedent(block)],
                                        env={**environment, 'TRANSFER_ID': transfer, 'TEST_PROTOCOL': protocol},
                                        capture_output=True, text=True, check=False)
                if attempt == 1:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Install the versioned tooling bootstrap', result.stderr)
                    self.assertFalse(receipt.exists())
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(receipt.read_text()),
                                     ['nurevolution-deploy production 12345-2 6789 ' + 'a' * 40, 'temporary-token'])
                self.assertNotIn('temporary-token', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
