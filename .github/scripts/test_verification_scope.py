import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from verification_scope import docs_only


class VerificationScope(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        previous = Path.cwd()
        os.chdir(temporary.name)
        self.addCleanup(os.chdir, previous)
        self.git('init', '-q', '--initial-branch=main')
        self.write('README.md', '# Project\n')
        self.write('docs/guide.md', '# Guide\n')
        self.write('app/player.ts', 'export const playing = false\n')
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL).decode().strip()

    def write(self, name, text):
        path = Path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid',
                 'commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def push(self, base=None):
        return docs_only('push', {'before': base or self.base,
                                  'after': self.git('rev-parse', 'HEAD')})

    def test_root_nested_and_unusual_markdown_paths(self):
        self.write('README.md', '# Updated project\n')
        self.write('docs/nested/a guide\nwith newline.md', '# Nested\n')
        self.commit()
        self.assertTrue(self.push())

    def test_non_markdown_inputs_and_mixed_changes_require_full_verification(self):
        for path in ['app/player.ts', '.github/workflows/verify.yml',
                     'docs/migration/inventory.json',
                     'docs/milestones/evidence/M03-feed-reference.json']:
            with self.subTest(path=path):
                self.git('reset', '--hard', self.base)
                self.write('README.md', '# Updated\n')
                self.write(path, 'changed\n')
                self.commit()
                self.assertFalse(self.push())

    def test_renaming_code_to_markdown_still_requires_full_verification(self):
        self.git('mv', 'app/player.ts', 'docs/player.md')
        self.commit()
        self.assertFalse(self.push())

    def test_markdown_deletion_and_rename_remain_docs_only(self):
        self.git('mv', 'README.md', 'docs/project.md')
        self.git('rm', 'docs/guide.md')
        self.commit()
        self.assertTrue(self.push())

    def test_empty_and_unavailable_push_history_require_full_verification(self):
        self.assertFalse(self.push())
        self.write('README.md', '# Updated\n')
        self.commit()
        for base in ['0' * 40, '1' * 40]:
            with self.subTest(base=base):
                self.assertFalse(self.push(base))

    def test_push_considers_all_commits_since_before(self):
        self.write('app/player.ts', 'export const playing = true\n')
        self.commit()
        self.write('README.md', '# Updated\n')
        self.commit()
        self.assertFalse(self.push())

    def test_pull_request_ignores_unrelated_base_branch_changes(self):
        self.git('checkout', '-qb', 'docs')
        self.write('README.md', '# Updated\n')
        head = self.commit()
        self.git('checkout', 'main')
        self.write('app/player.ts', 'export const playing = true\n')
        base = self.commit()
        self.assertTrue(docs_only('pull_request', {
            'pull_request': {'base': {'sha': base}, 'head': {'sha': head}},
        }))

    def test_pull_request_considers_earlier_code_changes(self):
        self.write('app/player.ts', 'export const playing = true\n')
        self.commit()
        self.write('README.md', '# Updated\n')
        head = self.commit()
        self.assertFalse(docs_only('pull_request', {
            'pull_request': {'base': {'sha': self.base}, 'head': {'sha': head}},
        }))

    def test_unknown_event_requires_full_verification(self):
        self.assertFalse(docs_only('workflow_dispatch', {}))
