#!/usr/bin/env python3
"""Run a build or reference VM exclusively, preserving an observable job record."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def resources():
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        memory[key] = int(value.strip().split()[0]) * 1024
    processes = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            executable = (entry / 'exe').resolve().name
            if executable.startswith('qemu-system'):
                processes.append({'pid': int(entry.name), 'kind': 'vm', 'executable': executable})
            elif executable in {'ninja', 'clang', 'clang++', 'ld.lld', 'lld', 'cc1', 'cc1plus'}:
                processes.append({'pid': int(entry.name), 'kind': 'build', 'executable': executable})
        except (OSError, PermissionError):
            continue
    return {'memAvailableBytes': memory['MemAvailable'], 'swapFreeBytes': memory['SwapFree'],
            'competitors': processes, 'memoryPressure': Path('/proc/pressure/memory').read_text().strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', required=True, choices=['build', 'vm'])
    parser.add_argument('--job-dir', required=True, type=Path)
    parser.add_argument('--cwd', type=Path, default=Path.cwd())
    parser.add_argument('--min-available-gib', type=float)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command and not args.check_only:
        parser.error('a command after -- is required')
    # This is also the historical native-build lock, so existing guarded builds conflict.
    lock = open('/tmp/aside-ninja.lock', 'a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('Resource lock is owned by another build/VM phase.', file=sys.stderr)
        return 75
    before = resources()
    minimum = args.min_available_gib if args.min_available_gib is not None else (10 if args.kind == 'build' else 8)
    conflicts = before['competitors']
    if conflicts or before['memAvailableBytes'] < minimum * 1024 ** 3:
        print(json.dumps({'status': 'not_started', 'requiredAvailableGiB': minimum, **before}), flush=True)
        return 75
    if args.check_only:
        print(json.dumps({'status': 'preflight_pass', 'kind': args.kind, **before}), flush=True)
        return 0
    args.job_dir.mkdir(parents=True, exist_ok=True)
    record = {'owner': 'Codex Aside restoration', 'kind': args.kind, 'command': command,
              'cwd': str(args.cwd.resolve()), 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'status': 'starting', 'before': before, 'wrapperPid': os.getpid(),
              'stopProtocol': 'build: SIGTERM owned process group; VM: guest shutdown or ACPI, never forced by this wrapper'}
    log = open(args.job_dir / 'command.log', 'ab', buffering=0)
    child = subprocess.Popen(command, cwd=args.cwd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    (args.job_dir / 'command.pid').write_text(str(child.pid) + '\n')
    record.update({'pid': child.pid, 'processGroup': child.pid, 'status': 'running'})
    print(json.dumps({'status': 'running', 'pid': child.pid, 'jobDir': str(args.job_dir.resolve())}), flush=True)
    stopping = False

    def request_stop(signum, frame):
        nonlocal stopping
        stopping = True
        if args.kind == 'build' and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
        elif args.kind == 'vm':
            record['attention'] = 'Graceful guest shutdown required; wrapper retains monitoring until VM exits.'

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    while child.poll() is None:
        current = resources()
        other_kind = 'vm' if args.kind == 'build' else 'build'
        conflict = [p for p in current['competitors'] if p['kind'] == other_kind]
        record.update({'heartbeatUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'resources': current})
        # Kill only our build if an independently launched VM appears; leave VM disks alone.
        if args.kind == 'build' and conflict and not stopping:
            record['attention'] = 'VM appeared during build; aborting owned build to avoid concurrent memory pressure.'
            stopping = True
            os.killpg(child.pid, signal.SIGTERM)
        elif args.kind == 'build' and current['memAvailableBytes'] < 1536 * 1024 ** 2 and not stopping:
            record['attention'] = 'Available memory below 1.5 GiB; aborting owned build for a lower-concurrency resume.'
            stopping = True
            os.killpg(child.pid, signal.SIGTERM)
        elif args.kind == 'vm' and conflict:
            record['attention'] = 'An external unguarded build appeared. Stop that build or gracefully shut down guest.'
        temporary = args.job_dir / 'status.json.tmp'
        temporary.write_text(json.dumps(record, indent=2) + '\n')
        temporary.replace(args.job_dir / 'status.json')
        time.sleep(2)
    record.update({'status': 'completed' if child.returncode == 0 else 'failed', 'exitCode': child.returncode,
                   'completedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    (args.job_dir / 'status.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'status': record['status'], 'exitCode': child.returncode}), flush=True)
    return child.returncode if child.returncode >= 0 else 128 - child.returncode


if __name__ == '__main__':
    sys.exit(main())
