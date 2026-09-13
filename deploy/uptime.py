#!/usr/bin/env python3
"""Bounded public production checks and incident/recovery notifications."""
import argparse
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

REPOSITORY = 'treyturner/nurevolution.net'
WORKFLOW = '.github/workflows/uptime.yml'
WEB = 'https://nurevolution.net'
MEDIA = 'https://podcast.nurevolution.net'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Unexpected redirect')


def fetch(url, limit, headers=None):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'nurevolution-monitor/1.0', 'Cache-Control': 'no-cache',
        **(headers or {}),
    })
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('Response too large')
        return response.status, response.headers, body


def page():
    status, _, body = fetch(WEB + '/', 2 * 1024 * 1024)
    if status != 200 or b'nurevolution studios' not in body:
        raise ValueError('Website response invalid')


def health():
    status, _, body = fetch(WEB + '/api/health', 65536)
    record = json.loads(body)
    if status != 200 or record.get('healthy') is not True or not re.fullmatch(
        r'[a-f0-9]{40}', record.get('release', '')
    ):
        raise ValueError('Application unhealthy')


def feed_and_audio():
    status, _, body = fetch(WEB + '/feed/podcast', 4 * 1024 * 1024)
    if status != 200 or b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():
        raise ValueError('Feed response invalid')
    items = ET.fromstring(body).findall('./channel/item')
    if len(items) < 55:
        raise ValueError('Protected archive missing')
    enclosure = items[0].find('enclosure')
    if enclosure is None:
        raise ValueError('Enclosure missing')
    url = enclosure.get('url', '')
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != 'https' or parts.netloc != 'podcast.nurevolution.net'
            or parts.query or parts.fragment or not parts.path.startswith('/')):
        raise ValueError('Unexpected enclosure origin')
    length = int(enclosure.get('length', '0'))
    status, headers, body = fetch(url, 1, {'Range': 'bytes=0-0'})
    if (status != 206 or len(body) != 1 or length <= 1
            or headers.get('Content-Range') != f'bytes 0-0/{length}'
            or headers.get('Content-Type', '').split(';')[0] != 'audio/mpeg'):
        raise ValueError('Audio range response invalid')


def certificate(host, address=None):
    with socket.create_connection((address or host, 443), timeout=15) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname=host) as tls:
            expiry = ssl.cert_time_to_seconds(tls.getpeercert()['notAfter'])
    if expiry - time.time() < 14 * 86400:
        raise ValueError('Certificate expires within 14 days')


def probe():
    checks = {
        'website': page,
        'application': health,
        'feed/audio': feed_and_audio,
        'website origin certificate': lambda: certificate('nurevolution.net', '159.89.86.21'),
        'audio certificate': lambda: certificate('podcast.nurevolution.net'),
        'Headscale certificate': lambda: certificate('headscale.treyturner.info'),
    }
    failures = []
    for label, check in checks.items():
        for attempt in range(2):
            try:
                check()
                break
            except Exception:
                # Remote bodies, URLs, and exception details never enter alerts/logs.
                if attempt:
                    failures.append(label)
                else:
                    time.sleep(3)
    return failures


def api(path, binary=False):
    result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/{path}'],
                            capture_output=True, timeout=45)
    if result.returncode:
        raise ValueError('Cannot read previous monitor state from GitHub')
    return result.stdout if binary else json.loads(result.stdout)


def previous_state():
    runs = api('actions/workflows/uptime.yml/runs?branch=main&status=completed&per_page=30')['workflow_runs']
    for run in runs:
        if (str(run['id']) == os.environ.get('GITHUB_RUN_ID') or run['path'] != WORKFLOW
                or run['head_branch'] != 'main' or run['event'] not in ('schedule', 'workflow_dispatch')
                or run['repository']['full_name'] != REPOSITORY):
            continue
        artifacts = api(f"actions/runs/{run['id']}/artifacts")['artifacts']
        for artifact in artifacts:
            if artifact['name'] != 'uptime-state' or artifact['expired']:
                continue
            if artifact['size_in_bytes'] > 65536:
                raise ValueError('Unexpected monitor artifact size')
            with zipfile.ZipFile(io.BytesIO(api(f"actions/artifacts/{artifact['id']}/zip", True))) as archive:
                entry = archive.getinfo('state.json')
                if entry.file_size > 16384:
                    raise ValueError('Unexpected monitor state size')
                state = json.loads(archive.read(entry))
            if (state.get('schemaVersion') != 1
                    or not isinstance(state.get('alertedFailures'), list)
                    or not all(isinstance(x, str) and len(x) < 80 for x in state['alertedFailures'])):
                raise ValueError('Invalid monitor state')
            return state['alertedFailures']
    return []


def webhook():
    url = os.environ.get('UPTIME_DISCORD_WEBHOOK', '')
    if not re.fullmatch(r'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]+', url):
        raise ValueError('UPTIME_DISCORD_WEBHOOK is missing or invalid')
    return url


def notify(failures):
    url = webhook()
    content = ('nurevolution production check FAILED: ' + ', '.join(failures)
               if failures else 'nurevolution production checks RECOVERED; all checks passed.')
    content += f' https://github.com/{REPOSITORY}/actions/workflows/uptime.yml'
    request = urllib.request.Request(url + '?wait=true', method='POST',
        data=json.dumps({'content': content, 'allowed_mentions': {'parse': []}}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'nurevolution-monitor/1.0'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            data = json.loads(response.read(16384))
            if response.status != 200 or not re.fullmatch(r'[0-9]{1,32}', data.get('id', '')):
                raise ValueError('Unconfirmed notification')
    except Exception:
        raise ValueError('Discord notification was not confirmed') from None


def run(state_path, previous, failures):
    alerted = previous
    try:
        if failures != previous:
            notify(failures)
            alerted = failures
    finally:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
            'failures': failures, 'alertedFailures': alerted,
        }, indent=2) + '\n')
    print(json.dumps({'healthy': not failures, 'failures': failures}))
    return int(bool(failures))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    if args.check_only:
        failures = probe()
        print(json.dumps({'healthy': not failures, 'failures': failures}))
        return int(bool(failures))
    if (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or os.environ.get('GITHUB_EVENT_NAME') not in ('schedule', 'workflow_dispatch')):
        raise ValueError('Notifications require the trusted main monitoring workflow')
    webhook()  # Fail visibly on missing credentials even while production is healthy.
    return run(Path('.local/uptime/state.json'), previous_state(), probe())


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('Production monitor failed; check configuration, notification delivery, and state access.')
        raise SystemExit(1) from None
