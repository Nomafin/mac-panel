import unittest

from hidpp import logi

logi.SETTLE = 0  # no waiting in tests

CHANGE_HOST, DEVICE_NAME = 0x1814, 0x0005


class FakeReceiver:
    """Answers HID++ requests like a Unifying receiver with the given devices.

    devices: {index: {'kind': 0|3, 'name': str, 'channel': 1-based, 'channels': n, 'silent': tries}}
    'silent' = how many requests the device ignores before answering (a sleeping keyboard).
    """
    FEATURES = {DEVICE_NAME: 5, CHANGE_HOST: 9}

    def __init__(self, devices):
        self.devices = devices
        self.sent = []

    def send(self, device, feature, function, params=b''):
        self.ask(device, feature, function, params)

    def ask(self, device, feature, function, params=b''):
        self.sent.append((device, feature, function, bytes(params)))
        d = self.devices.get(device)
        if not d:
            return logi.ERROR  # the receiver answers at once: no such device
        if d.get('late_check', 0) > 0 and feature == 9 and function == 0 and d.get('switch_seen'):
            d['late_check'] -= 1
            return None  # slow to answer after a switch command
        if d.get('silent', 0) > 0:
            d['silent'] -= 1
            return None
        if feature == 0 and function == 0:  # root getFeature
            fid = int.from_bytes(params[:2], 'big')
            return bytes([self.FEATURES.get(fid, 0), 0, 0])
        if feature == 5 and function == 0:
            return bytes([len(d['name'])])
        if feature == 5 and function == 1:
            return d['name'].encode()[params[0]:params[0] + 16]
        if feature == 5 and function == 2:
            return bytes([d['kind']])
        if feature == 9 and function == 0:
            return bytes([d['channels'], d['channel'] - 1, 0])
        if feature == 9 and function == 1:
            d['switch_seen'] = True
            if d.get('ignore_switch', 0) > 0:  # a dozing keyboard can miss it
                d['ignore_switch'] -= 1
                return None
            d['channel'] = params[0] + 1
            del self.devices[device]  # it left this receiver
            return None
        return None


def mouse(channel=2, **kw):
    return {'kind': 3, 'name': 'MX Vertical', 'channel': channel, 'channels': 3, **kw}


def keyboard(channel=1, **kw):
    return {'kind': 0, 'name': 'ERGO K860', 'channel': channel, 'channels': 3, **kw}


class LogiTest(unittest.TestCase):
    def test_request_bytes(self):
        self.assertEqual(logi.request(2, 9, 1, b'\x01'), bytes([0x10, 2, 9, 0x1A, 1, 0, 0]))
        self.assertEqual(len(logi.request(1, 0, 0)), 7)

    def test_parse_reply_error_and_mismatch(self):
        ok = bytes([0x11, 2, 9, 0x0A, 3, 1, 0] + [0] * 13)
        self.assertEqual(logi.parse_reply(ok, 2, 9, 0)[:2], bytes([3, 1]))
        self.assertIsNone(logi.parse_reply(bytes([0x10, 2, 0x8F, 9, 0x0A, 2, 0]), 2, 9, 0))
        self.assertIsNone(logi.parse_reply(bytes([0x11, 2, 0xFF, 9, 0x0A, 5] + [0] * 14), 2, 9, 0))
        self.assertIsNone(logi.parse_reply(ok, 1, 9, 0))  # another device
        self.assertIsNone(logi.parse_reply(ok, 2, 9, 1))  # another function
        self.assertIsNone(logi.parse_reply(b'', 2, 9, 0))

    def test_list_reports_kind_and_channel(self):
        r = FakeReceiver({1: mouse(), 2: keyboard()})
        self.assertEqual(logi.list_devices(r), [
            {'index': 1, 'kind': 'mouse', 'name': 'MX Vertical', 'channel': 2, 'channels': 3},
            {'index': 2, 'kind': 'keyboard', 'name': 'ERGO K860', 'channel': 1, 'channels': 3},
        ])

    def test_set_host_sends_skips_and_reports(self):
        r = FakeReceiver({1: mouse(channel=2), 2: keyboard(channel=1)})
        self.assertEqual(logi.set_host([r], {'mouse': 1, 'keyboard': 1}), {'mouse': 'sent', 'keyboard': 'already'})
        self.assertIn((1, 9, 1, b'\x00'), r.sent)
        self.assertFalse(any(d == 2 and f == 9 and fn == 1 for d, f, fn, _ in r.sent))

    def test_set_host_not_here(self):
        r = FakeReceiver({1: mouse()})
        self.assertEqual(logi.set_host([r], {'mouse': 2, 'keyboard': 2}), {'mouse': 'already', 'keyboard': 'not_here'})

    def test_set_host_over_two_receivers(self):
        a, b = FakeReceiver({1: mouse(channel=2)}), FakeReceiver({1: keyboard(channel=1)})
        self.assertEqual(logi.set_host([a, b], {'mouse': 1, 'keyboard': 2}), {'mouse': 'sent', 'keyboard': 'sent'})

    def test_slow_device_retries(self):
        r = FakeReceiver({2: keyboard(channel=1, silent=2)})
        self.assertEqual(logi.set_host([r], {'keyboard': 2}), {'keyboard': 'sent'})
        never = FakeReceiver({2: keyboard(channel=1, silent=99)})
        self.assertEqual(logi.set_host([never], {'keyboard': 2}), {'keyboard': 'not_here'})

    def test_a_missed_switch_is_sent_again(self):
        r = FakeReceiver({2: keyboard(channel=1, ignore_switch=1)})
        self.assertEqual(logi.set_host([r], {'keyboard': 2}), {'keyboard': 'sent'})
        self.assertEqual(sum(1 for d, f, fn, _ in r.sent if f == 9 and fn == 1), 2)

    def test_a_device_that_never_leaves_has_failed(self):
        r = FakeReceiver({2: keyboard(channel=1, ignore_switch=99)})
        self.assertEqual(logi.set_host([r], {'keyboard': 2}), {'keyboard': 'failed'})

    def test_a_slow_answer_after_a_missed_switch_still_gets_a_resend(self):
        r = FakeReceiver({2: keyboard(channel=1, ignore_switch=1, late_check=1)})
        self.assertEqual(logi.set_host([r], {'keyboard': 2}), {'keyboard': 'sent'})
        self.assertEqual(sum(1 for d, f, fn, _ in r.sent if f == 9 and fn == 1), 2)
        self.assertEqual(r.devices, {})  # it really left

    def test_an_error_reply_is_not_retried(self):
        r = FakeReceiver({})
        self.assertIsNone(logi.call(r, 3, 0, 0, b'\x00\x05'))
        self.assertEqual(len(r.sent), 1)

    def test_errors_for_other_software_are_not_ours(self):
        ours = bytes([0x10, 2, 0x8F, 9, 0x0A, 9, 0])
        theirs = bytes([0x10, 2, 0x8F, 9, 0x01, 9, 0])  # another app's software id
        self.assertTrue(logi.is_error(ours, 2))
        self.assertFalse(logi.is_error(theirs, 2))
        self.assertFalse(logi.is_error(ours, 1))

    def test_parse_assignments(self):
        self.assertEqual(logi.parse_assignments(['mouse=1', 'keyboard=2']), {'mouse': 1, 'keyboard': 2})
        for bad in (['mouse'], ['mouse=x'], ['mouse=0'], ['mouse=4'], ['trackpad=1']):
            with self.assertRaises(ValueError):
                logi.parse_assignments(bad)


if __name__ == '__main__':
    unittest.main()
