#!/usr/bin/env python3
"""Own a private X display and run the existing 914 fork launcher. Never stop foreign processes."""
import argparse, json, os, pathlib, secrets, shutil, signal, socket, subprocess, tempfile, time

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--sand-root',default='.cache/belmont-wsl-profile/sand-data')
    parser.add_argument('--display',default=':109')
    parser.add_argument('--state-dir',default='belmont-browse/.state')
    args=parser.parse_args()
    repo=pathlib.Path(__file__).resolve().parents[1]
    root=(repo/args.sand_root).resolve()
    config=json.loads((root/'browser-bot.json').read_text())
    if config.get('version')!=1: raise SystemExit('Register the browser bot first')
    expected_state=(repo / args.state_dir / 'serve.json').resolve()
    if pathlib.Path(config.get('serviceStateFile','')).resolve()!=expected_state:
        raise SystemExit('Registration serviceStateFile does not match --state-dir; register the intended discovery path first')
    if not args.display.startswith(':') or not args.display[1:].isdigit(): raise SystemExit('Use a dedicated local display such as :109')
    for binary in ('Xvfb','xauth','xdpyinfo','x11vnc','websockify'):
        if shutil.which(binary) is None: raise SystemExit(f'Required executable is missing: {binary}')
    if subprocess.run(['xdpyinfo','-display',args.display],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
        raise SystemExit(f'{args.display} already exists. Refusing to expose a foreign/shared display.')
    with socket.socket() as probe:
        probe.settimeout(.5)
        if probe.connect_ex(('127.0.0.1',21420))==0:
            raise SystemExit('Port 21420 is occupied. Close the official Aside / existing daemon yourself; nothing was stopped.')
    children=[]
    def stop(*_): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    with tempfile.TemporaryDirectory(prefix='belmont-browser-xauth-') as temp:
        auth=pathlib.Path(temp)/'Xauthority';auth.touch(mode=0o600)
        subprocess.run(['xauth','-f',str(auth),'add',args.display,'.',secrets.token_hex(16)],check=True)
        env=os.environ.copy();env.update({'DISPLAY':args.display,'XAUTHORITY':str(auth),
            'BELMONT_BROWSE_DISPLAY':args.display,'BELMONT_BROWSE_ENGINE':'914',
            'BELMONT_BROWSE_STATE_DIR':str((repo/args.state_dir).resolve()),
            'BELMONT_BROWSE_TRANSPORT':'port','BELMONT_BROWSER_BOT_ID':config['botId'],
            'BELMONT_MEMORY_AUTHORITY':'belmont','BELMONT_BROWSE_SCREEN':'1'})
        if env.get('BELMONT_BROWSE_ALLOW_UNVERIFIED_NATIVE')=='1':
            raise SystemExit('Refusing the unverified-native override in the dedicated launcher')
        try:
            x=subprocess.Popen(['Xvfb',args.display,'-screen','0','1440x900x24','-nolisten','tcp','-auth',str(auth)],env=env)
            children.append(x)
            for _ in range(60):
                if x.poll() is not None: raise SystemExit('Owned Xvfb exited during startup')
                if subprocess.run(['xdpyinfo','-display',args.display],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
                time.sleep(.1)
            else: raise SystemExit('Owned Xvfb did not become ready')
            service=subprocess.Popen(['bash','run-fork.sh'],cwd=repo/'belmont-browse',env=env)
            children.append(service)
            return service.wait()
        except KeyboardInterrupt:
            return 130
        finally:
            for child in reversed(children):
                if child.poll() is None:
                    child.terminate()
                    try:child.wait(timeout=15)
                    except subprocess.TimeoutExpired:child.kill();child.wait()

if __name__=='__main__': raise SystemExit(main())
