"""Select only a published, successful main release for production promotion."""

import json
import os
from pathlib import Path
import re
import subprocess


REPOSITORY = 'treyturner/nurevolution.net'


def api(path, paginate=False):
    command = ['gh', 'api', f'repos/{REPOSITORY}/{path}']
    if paginate:
        command.append('--paginate')
    response = subprocess.check_output(command, text=True)
    if not paginate:
        return json.loads(response)
    # gh emits consecutive JSON documents for paginated REST responses.
    # Decode them without requiring the newer CLI's --slurp option.
    pages = []
    decoder = json.JSONDecoder()
    remaining = response.lstrip()
    while remaining:
        page, end = decoder.raw_decode(remaining)
        pages.append(page)
        remaining = remaining[end:].lstrip()
    return pages


def select_source(event_name, event, repository, ref, request=api):
    if repository != REPOSITORY or ref != 'refs/heads/main':
        raise ValueError('Deployment must run in the production repository on main')
    automatic = event_name == 'workflow_run'
    if automatic:
        source = event['workflow_run']
        if (event.get('action') != 'completed' or source.get('event') != 'push'
                or source.get('conclusion') != 'success' or source.get('head_branch') != 'main'
                or source.get('head_repository', {}).get('full_name') != REPOSITORY):
            return None
        run_id, commit = str(source['id']), source['head_sha']
    elif event_name == 'workflow_dispatch':
        run_id, commit = event['inputs']['verify_run_id'], event['inputs']['source_commit']
    else:
        raise ValueError('Unsupported deployment event')
    if not re.fullmatch(r'[1-9][0-9]*', run_id) or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Invalid verification run ID or full commit SHA')

    run = request(f'actions/runs/{run_id}')
    if (run.get('id') != int(run_id) or run.get('event') != 'push'
            or run.get('status') != 'completed' or run.get('conclusion') != 'success'
            or run.get('head_branch') != 'main' or run.get('head_sha') != commit
            or run.get('path') != '.github/workflows/verify.yml'
            or run.get('repository', {}).get('full_name') != REPOSITORY
            or run.get('head_repository', {}).get('full_name') != REPOSITORY):
        raise ValueError('Source is not the requested successful main Verify run')

    jobs = [job for page in request(f'actions/runs/{run_id}/jobs?per_page=100', True)
            for job in page['jobs'] if job['name'] == 'publish']
    if automatic and len(jobs) == 1 and jobs[0]['conclusion'] == 'skipped':
        print('No deployment: this Verify run skipped release publication (docs-only).')
        return None
    if len(jobs) != 1 or jobs[0]['conclusion'] != 'success':
        raise ValueError('Verify did not successfully publish a release')

    artifacts = [artifact for page in request(f'actions/runs/{run_id}/artifacts?per_page=100', True)
                 for artifact in page['artifacts'] if artifact['name'] == f'release-{commit}']
    if len(artifacts) != 1 or artifacts[0]['expired']:
        raise ValueError('Expected exactly one nonexpired release artifact from this run')

    # Check again after acquiring deployment concurrency: a queued run or an
    # old Verify rerun must not automatically replace a newer main release.
    if automatic and request('git/ref/heads/main')['object']['sha'] != commit:
        print('No deployment: the verified commit has been superseded on main.')
        return None
    return {'verify_run_id': run_id, 'source_commit': commit}


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    selected = select_source(os.environ['GITHUB_EVENT_NAME'], event,
                             os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_REF'])
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'ready={str(selected is not None).lower()}\n')
        for name, value in (selected or {}).items():
            output.write(f'{name}={value}\n')


if __name__ == '__main__':
    main()
