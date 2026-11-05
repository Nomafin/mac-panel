import importlib.util
import json
import os
import threading
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location('agent', os.path.join(HERE, '..', '..', 'pc-agent', 'agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

KEY = 'a' * 64


class AgentTest(unittest.TestCase):
    def start(self, allow=('127.0.0.1',)):
        self.calls = []
        actions = {'/devices/host': lambda channels: self.calls.append(channels) or {'mouse': 'sent'}}
        self.server = agent.make_server({'port': 0, 'key': KEY, 'allow': list(allow)}, actions, host='127.0.0.1')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, body, key=KEY, path='/devices/host'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        req = urllib.request.Request(f'http://127.0.0.1:{self.server.server_address[1]}{path}', data=data, method='POST')
        if key is not None:
            req.add_header('Authorization', 'Bearer ' + key)
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')

    def test_good_request_runs_action(self):
        self.start()
        self.assertEqual(self.post({'channels': {'mouse': 2, 'keyboard': 1}}), (200, {'result': {'mouse': 'sent'}}))
        self.assertEqual(self.calls, [{'mouse': 2, 'keyboard': 1}])

    def test_wrong_key_403(self):
        self.start()
        self.assertEqual(self.post({'channels': {'mouse': 2}}, key='b' * 64)[0], 403)
        self.assertEqual(self.calls, [])

    def test_missing_key_403(self):
        self.start()
        self.assertEqual(self.post({'channels': {'mouse': 2}}, key=None)[0], 403)
        self.assertEqual(self.calls, [])

    def test_other_address_403(self):
        self.start(allow=('192.168.1.62',))
        self.assertEqual(self.post({'channels': {'mouse': 2}})[0], 403)
        self.assertEqual(self.calls, [])

    def test_bad_bodies_400(self):
        self.start()
        for body in (b'not json', {'channels': {'mouse': 0}}, {'channels': {'mouse': 4}}, {'channels': {'mouse': '2'}},
                     {'channels': {'trackpad': 1}}, {'channels': {}}, {'nope': 1}, [1], b'{"channels": {"mouse": 1}}' + b' ' * 5000,
                     {'channels': {'mouse': True}}):
            self.assertEqual(self.post(body)[0], 400, body)
        self.assertEqual(self.calls, [])

    def test_unknown_path_404(self):
        self.start()
        self.assertEqual(self.post({'channels': {'mouse': 1}}, path='/other')[0], 404)

    def test_server_survives_bad_request(self):
        self.start()
        self.post(b'\xff\xfe')
        self.assertEqual(self.post({'channels': {'mouse': 1}})[0], 200)

    def test_allowed_compares_key_and_address(self):
        cfg = {'key': KEY, 'allow': ['10.0.0.2']}
        self.assertTrue(agent.allowed('10.0.0.2', 'Bearer ' + KEY, cfg))
        self.assertFalse(agent.allowed('10.0.0.3', 'Bearer ' + KEY, cfg))
        self.assertFalse(agent.allowed('10.0.0.2', KEY, cfg))
        self.assertFalse(agent.allowed('10.0.0.2', None, cfg))
        self.assertFalse(agent.allowed('10.0.0.2', 'Bearer ', {'key': '', 'allow': ['10.0.0.2']}))

    def test_requests_run_one_at_a_time(self):
        import time
        active, peak = [0], [0]

        def slow(channels):
            active[0] += 1
            peak[0] = max(peak[0], active[0])
            time.sleep(0.2)
            active[0] -= 1
            return {}
        self.server = agent.make_server({'port': 0, 'key': KEY, 'allow': ['127.0.0.1']}, {'/devices/host': slow}, host='127.0.0.1')
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threads = [threading.Thread(target=self.post, args=({'channels': {'mouse': 1}},)) for _ in range(3)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(peak[0], 1)

    def test_bad_content_length_400(self):
        import socket
        self.start()
        for length in ('abc', '-1'):
            with socket.create_connection(('127.0.0.1', self.server.server_address[1]), timeout=3) as s:
                s.sendall(('POST /devices/host HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + KEY +
                           '\r\nContent-Length: ' + length + '\r\n\r\n').encode())
                self.assertIn(b' 400 ', s.recv(200), length)

    def test_load_config_accepts_a_bom(self):
        import tempfile
        with tempfile.NamedTemporaryFile('wb', suffix='.json', delete=False) as f:
            f.write(b'\xef\xbb\xbf{"port": 8766, "key": "k", "allow": ["1.2.3.4"]}')  # Windows PowerShell 5's utf8
        self.addCleanup(os.remove, f.name)
        self.assertEqual(agent.load_config(f.name), {'port': 8766, 'key': 'k', 'allow': ['1.2.3.4']})


if __name__ == '__main__':
    unittest.main()
