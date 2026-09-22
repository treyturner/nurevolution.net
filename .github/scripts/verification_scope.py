"""Limit verification only when the complete event diff is known to be Markdown."""

import json
import os
import subprocess


def docs_only(event_name, event):
    if event_name == 'pull_request':
        base = event['pull_request']['base']['sha']
        head = event['pull_request']['head']['sha']
        revision = f'{base}...{head}'
    elif event_name == 'push':
        base, head = event['before'], event['after']
        revision = f'{base}..{head}'
    else:
        return False
    try:
        # Include both paths of renames, especially code renamed to Markdown.
        changed = subprocess.check_output(
            ['git', 'diff', '--name-only', '--no-renames', '-z', revision, '--'],
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        # Missing history (including a new branch's zero SHA) requires full CI.
        return False
    paths = [path for path in changed.split(b'\0') if path]
    return bool(paths) and all(path.endswith(b'.md') for path in paths)


if __name__ == '__main__':
    with open(os.environ['GITHUB_EVENT_PATH']) as source:
        event = json.load(source)
    result = docs_only(os.environ['GITHUB_EVENT_NAME'], event)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'docs_only={str(result).lower()}\n')
