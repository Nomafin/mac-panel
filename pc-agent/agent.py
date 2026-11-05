"""Mac Panel's helper on a Windows PC: runs actions the Mac asks for over the home network.

Requests: POST <path> with a JSON body, `Authorization: Bearer <key>`, from an address in `allow`.
Config: %APPDATA%\\mac-panel-agent\\config.json = {"port": 8766, "key": "…", "allow": ["<the Mac's IP>"]}
"""
import hmac
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 4096
KINDS = ('keyboard', 'mouse')
log = logging.getLogger('mac-panel-agent')


def allowed(client_ip, auth_header, config):
    key = config.get('key') or ''
    if not key or client_ip not in config.get('allow', []) or not auth_header or not auth_header.startswith('Bearer '):
        return False
    return hmac.compare_digest(auth_header[len('Bearer '):].encode(), key.encode())


def parse_channels(body):
    """{"channels": {"mouse": 2, "keyboard": 1}} -> {'mouse': 2, 'keyboard': 1}; None if anything is off."""
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    channels = data.get('channels') if isinstance(data, dict) else None
    if not isinstance(channels, dict) or not channels:
        return None
    for kind, channel in channels.items():
        if kind not in KINDS or type(channel) is not int or not 1 <= channel <= 3:
            return None
    return channels


def load_config(path):
    with open(path, encoding='utf-8-sig') as f:  # Windows PowerShell 5 writes UTF-8 with a BOM
        return json.load(f)


def make_server(config, actions, host='0.0.0.0'):
    lock = threading.Lock()  # one action at a time: two would read each other's receiver replies

    class Handler(BaseHTTPRequestHandler):
        timeout = 10  # a client that stalls doesn't hold a thread forever

        def reply(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if not allowed(self.client_address[0], self.headers.get('Authorization'), config):
                log.warning('refused %s %s', self.client_address[0], self.path)
                return self.reply(403, {'error': 'forbidden'})
            action = actions.get(self.path)
            if not action:
                return self.reply(404, {'error': 'not_found'})
            try:
                length = int(self.headers.get('Content-Length') or 0)
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_BODY:
                return self.reply(400, {'error': 'bad_request'})
            channels = parse_channels(self.rfile.read(length))
            if channels is None:
                return self.reply(400, {'error': 'bad_request'})
            try:
                with lock:
                    result = action(channels)
            except Exception:
                log.exception('%s failed', self.path)
                return self.reply(500, {'error': 'failed'})
            log.info('%s %s -> %s', self.path, channels, result)
            self.reply(200, {'result': result})

        def log_message(self, fmt, *args):
            pass  # requests are logged above, without the noise

    return ThreadingHTTPServer((host, config.get('port', 8766)), Handler)


def main():
    folder = os.path.join(os.environ.get('APPDATA', HERE), 'mac-panel-agent')
    os.makedirs(folder, exist_ok=True)
    handler = RotatingFileHandler(os.path.join(folder, 'agent.log'), maxBytes=1_000_000, backupCount=1, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    sys.path.insert(0, os.path.dirname(HERE))  # the repo root, for hidpp
    sys.path.insert(0, HERE)
    try:
        config = load_config(os.path.join(folder, 'config.json'))
        from actions import devices
        server = make_server(config, {'/devices/host': devices.host})
    except Exception:
        log.exception('could not start')
        raise
    log.info('listening on port %s', server.server_address[1])
    server.serve_forever()


if __name__ == '__main__':
    main()
