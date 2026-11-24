#!/usr/bin/env python3
"""Recover the BaoTa-managed project while respecting intentional stops."""

import argparse
import datetime
import fcntl
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request


STATE_DIR = Path('/var/lib/smsbazaar-maintenance')
PROJECT_DIR = Path('/www/wwwroot/smsbazaar')
PANEL_DIR = Path('/www/server/panel')
PANEL_PYTHON = PANEL_DIR / 'pyenv/bin/python'
RETRY_LIMIT = 3
RESTART_COOLDOWN = 300
MEMORY_LIMIT_KIB = 384 * 1024


def read_state(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def api_healthy():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:8787/api/meta', timeout=8) as response:
            payload = json.loads(response.read(65536))
        return payload.get('service', {}).get('serviceKey') == 'openai_chatgpt'
    except (OSError, ValueError):
        return False


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=3):
            return True
    except OSError:
        return False


def task_alive():
    try:
        pid = int((PANEL_DIR / 'logs/task.pid').read_text().strip())
        return Path('/proc/{}/comm'.format(pid)).read_text().strip() == 'BT-Task'
    except (OSError, ValueError):
        return False


def project_memory_kib():
    total = 0
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / 'cwd').resolve() != PROJECT_DIR:
                continue
            name = (entry / 'comm').read_text().strip()
            if name != 'node' and not name.startswith('npm'):
                continue
            for line in (entry / 'status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    total += int(line.split()[1])
                    break
        except (OSError, ValueError):
            continue
    return total


def recovery_due(state, name, healthy, now):
    failures = 0 if healthy else state.get(name + '_failures', 0) + 1
    state[name + '_failures'] = failures
    return failures >= RETRY_LIMIT and now - state.get(name + '_last_attempt', 0) >= RESTART_COOLDOWN


def run_command(command, timeout=90):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    # Panel commands can print credentials in error paths; keep their output local.
    if result.returncode:
        raise RuntimeError('Maintenance command failed with status {}'.format(result.returncode))


def recover_project():
    code = """
import os, sys
os.chdir('/www/server/panel')
sys.path.insert(0, 'class')
import public
from projectModel.nodejsModel import main
model = main()
project = model.get_project_find('smsbazaar')
if not project or model.is_stop_by_user(project['id']):
    sys.exit(75)
args = public.dict_obj()
args.project_name = 'smsbazaar'
result = model.restart_project(args)
sys.exit(0 if result.get('status') else 1)
"""
    # Keep recovered Node processes outside this short-lived healthcheck service.
    command = [
        'systemd-run', '--scope', '--quiet', '--collect',
        '--unit=smsbazaar-project-recovery-{}'.format(time.time_ns()),
        '-p', 'MemoryMax=512M', '-p', 'MemorySwapMax=512M',
        str(PANEL_PYTHON), '-c', code,
    ]
    result = subprocess.run(command, capture_output=True, timeout=90)
    if result.returncode == 75:
        return 'intentionally_stopped'
    if result.returncode:
        raise RuntimeError('BaoTa project restart failed')
    return 'restarted'


def record_sample(healthy, rss_kib):
    day = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    with (STATE_DIR / ('memory-' + day + '.csv')).open('a') as output:
        output.write('{},{},{}\n'.format(int(time.time()), rss_kib, int(healthy)))


def check(state, dry_run=False):
    now = time.time()
    healthy = api_healthy()
    rss_kib = project_memory_kib()
    node_ok = healthy and rss_kib < MEMORY_LIMIT_KIB
    if recovery_due(state, 'project', node_ok, now):
        if dry_run:
            print('Would recover BaoTa project after consecutive failures')
        else:
            state['project_last_attempt'] = now
            outcome = recover_project()
            if outcome == 'intentionally_stopped':
                state['project_failures'] = 0
            print('BaoTa project: ' + outcome)

    panel_active = subprocess.run(
        ['systemctl', 'is-active', 'bt.service'], capture_output=True, text=True, timeout=5,
    ).stdout.strip()
    try:
        panel_port = int((PANEL_DIR / 'data/port.pl').read_text().strip())
    except (OSError, ValueError):
        panel_port = 13191
    panel_ok = panel_active == 'inactive' or (port_open(panel_port) and task_alive())
    if recovery_due(state, 'panel', panel_ok, now):
        if dry_run:
            print('Would recover BaoTa panel after consecutive failures')
        else:
            state['panel_last_attempt'] = now
            run_command(['systemctl', 'restart', 'bt.service'])
            print('BaoTa panel restarted')
    if not dry_run:
        record_sample(healthy, rss_kib)
    return healthy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (STATE_DIR / 'paused').exists():
        return
    with (STATE_DIR / 'health.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = read_state(STATE_DIR / 'health.json')
        try:
            check(state, dry_run=args.dry_run)
        finally:
            if not args.dry_run:
                pending = STATE_DIR / 'health.json.pending'
                pending.write_text(json.dumps(state))
                pending.replace(STATE_DIR / 'health.json')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Maintenance error: {}'.format(error), file=sys.stderr)
        sys.exit(1)
