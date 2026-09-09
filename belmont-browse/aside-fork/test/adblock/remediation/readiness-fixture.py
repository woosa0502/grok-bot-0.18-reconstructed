#!/usr/bin/env python3
"""Own ephemeral fixture only. Never connects to a browser or touches a profile.

The parent can start with --port 0 --ready-json /task/artifact/fixture.json and
point two subscriptions in a NEW test profile at the returned first/second list
URLs. The first list is immediate; the second takes three seconds. This exposes
the actual service sequence: empty compile -> partial compile -> ready compile.
Use /failed.txt in a separate profile to exercise terminal download failure.
"""
import argparse
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=0)
parser.add_argument('--ready-json', type=Path, required=True)
args = parser.parse_args()
if args.port == 18777:
    raise SystemExit('Refusing the protected live fixture port')
started = time.monotonic()
page = Path(__file__).with_name('readiness.html').read_bytes()
late_page = Path(__file__).with_name('late-ad.html').read_bytes()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path).path
        status = 200
        mime = 'text/plain; charset=utf-8'
        if route == '/first.txt':
            body = b'! immediate partial list\n##.remediation-late-ad\n'
        elif route == '/second.txt':
            time.sleep(3)
            body = b'! delayed initial list\n##.remediation-second-late-ad\n'
        elif route == '/failed.txt':
            time.sleep(1)
            status = 503
            body = b'deliberate initial subscription failure'
        elif route in ('/', '/page', '/late'):
            body = late_page if route == '/late' else page
            mime = 'text/html; charset=utf-8'
        else:
            status = 404
            body = b'unknown fixture route'
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(json.dumps({'route': route, 'status': status,
                          'elapsed_s': round(time.monotonic() - started, 3)}), flush=True)

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
port = server.server_address[1]
args.ready_json.write_text(json.dumps({'port': port, 'base_url': f'http://127.0.0.1:{port}',
                                      'owner': 'isolated-adblock-readiness-fixture', 'pid': os.getpid()}, indent=2)+'\n')
server.serve_forever()
