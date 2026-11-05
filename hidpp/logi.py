"""Logitech Easy-Switch from software: list the keyboards and mice paired to this computer's
Unifying or Bolt receiver, and send them to another channel (HID++ 2.0 CHANGE_HOST, 0x1814).

    python -m hidpp.logi list
    python -m hidpp.logi set-host mouse=1 keyboard=2

Both print JSON. Channels are 1-based, like the numbers on the devices. Needs `pip install hidapi`.
"""
import json
import sys
import time

LOGITECH = 0x046D
RECEIVERS = (0xC52B, 0xC548)  # Unifying, Bolt
SHORT, LONG = 0x10, 0x11
SW_ID = 0xA  # marks our requests, so replies to other software are ignored
ROOT, DEVICE_NAME, CHANGE_HOST = 0x0000, 0x0005, 0x1814
KINDS = {0: 'keyboard', 3: 'mouse', 4: 'mouse', 5: 'mouse'}  # HID++ device types: keyboard, mouse, trackpad, trackball
TRIES = 3  # a sleeping keyboard can miss the first request or two
TIMEOUT = 1.0


def request(device, feature, function, params=b''):
    """A short HID++ request: report id, device index, feature index, function | software id, 3 params."""
    return bytes([SHORT, device, feature, (function << 4) | SW_ID]) + bytes(params)[:3].ljust(3, b'\0')


def is_error(data, device):
    """An error reply for this device (HID++ 1.0 0x8F or HID++ 2.0 0xFF)."""
    return len(data) >= 3 and data[0] in (SHORT, LONG) and data[1] == device and data[2] in (0x8F, 0xFF)


def parse_reply(data, device, feature, function):
    """The reply's parameters, or None for an error or a message that isn't the reply to this request."""
    if len(data) < 4 or data[0] not in (SHORT, LONG) or data[1] != device or is_error(data, device):
        return None
    if data[2] != feature or data[3] != ((function << 4) | SW_ID):
        return None
    return bytes(data[4:])


def call(receiver, device, feature, function, params=b''):
    for _ in range(TRIES):
        reply = receiver.ask(device, feature, function, params)
        if reply is not None:
            return reply
    return None


def feature_index(receiver, device, feature_id):
    reply = call(receiver, device, ROOT, 0, feature_id.to_bytes(2, 'big'))
    return reply[0] if reply and reply[0] else None


def _devices(receiver):
    found = []
    for index in range(1, 7):
        name_feature = feature_index(receiver, index, DEVICE_NAME)
        host_feature = name_feature and feature_index(receiver, index, CHANGE_HOST)
        if not host_feature:
            continue
        kind = call(receiver, index, name_feature, 2)
        hosts = call(receiver, index, host_feature, 0)
        if not kind or not hosts or kind[0] not in KINDS:
            continue
        length = (call(receiver, index, name_feature, 0) or b'\0')[0]
        name = b''
        while len(name) < length:
            part = call(receiver, index, name_feature, 1, bytes([len(name)]))
            if not part:
                break
            name += part[: length - len(name)]
        found.append({'index': index, 'kind': KINDS[kind[0]], 'name': name.decode(errors='replace'),
                      'channel': hosts[1] + 1, 'channels': hosts[0], 'feature': host_feature})
    return found


def list_devices(receiver):
    """The keyboards and mice online on this receiver, with their current channel."""
    return [{k: v for k, v in d.items() if k != 'feature'} for d in _devices(receiver)]


def set_host(receivers, channels):
    """Send each device of a kind in `channels` to that channel. Returns {kind: sent | already | not_here}."""
    result = {kind: 'not_here' for kind in channels}
    for receiver in receivers:
        for d in _devices(receiver):
            target = channels.get(d['kind'])
            if target is None:
                continue
            if d['channel'] == target:
                result[d['kind']] = 'already' if result[d['kind']] != 'sent' else 'sent'
            else:
                receiver.send(d['index'], d['feature'], 1, bytes([target - 1]))  # no reply: the device leaves
                result[d['kind']] = 'sent'
    return result


def parse_assignments(args):
    """['mouse=1', 'keyboard=2'] -> {'mouse': 1, 'keyboard': 2}; ValueError for anything else."""
    out = {}
    for arg in args:
        kind, _, value = arg.partition('=')
        if kind not in set(KINDS.values()) or not value.isdigit() or not 1 <= int(value) <= 3:
            raise ValueError(f'expected keyboard=N or mouse=N with N 1-3, got {arg!r}')
        out[kind] = int(value)
    return out


class Receiver:
    """One receiver's HID++ interface. macOS gives one handle for the whole receiver (a second open
    fails); Windows has one per report size, and long replies arrive only on the long one."""

    def __init__(self, paths):
        import hid
        self.handles = []
        for path in paths:
            h = hid.device()
            try:
                h.open_path(path)
            except OSError:
                continue
            h.set_nonblocking(True)
            self.handles.append(h)
        if not self.handles:
            raise OSError('cannot open the receiver')

    def send(self, device, feature, function, params=b''):
        self.handles[0].write(request(device, feature, function, params))

    def ask(self, device, feature, function, params=b''):
        for h in self.handles:  # drop stale input
            while h.read(64):
                pass
        self.send(device, feature, function, params)
        end = time.monotonic() + TIMEOUT
        while time.monotonic() < end:
            for h in self.handles:
                data = bytes(h.read(64))
                if not data:
                    continue
                if is_error(data, device):
                    return None
                reply = parse_reply(data, device, feature, function)
                if reply is not None:
                    return reply
            time.sleep(0.005)
        return None

    def close(self):
        for h in self.handles:
            h.close()


def open_receivers():
    import hid
    by_receiver = {}
    for d in hid.enumerate(LOGITECH):
        if d['product_id'] in RECEIVERS and d['usage_page'] == 0xFF00 and d['usage'] in (1, 2):
            by_receiver.setdefault(d.get('serial_number') or d['product_id'], []).append((d['usage'], d['path']))
    receivers = []
    for paths in by_receiver.values():
        try:
            receivers.append(Receiver([p for _, p in sorted(paths)]))  # short (usage 1) first: requests go there
        except OSError:
            pass
    return receivers


def main(argv):
    if not argv or argv[0] not in ('list', 'set-host'):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        channels = parse_assignments(argv[1:]) if argv[0] == 'set-host' else None
    except ValueError as e:
        print(json.dumps({'error': str(e)}))
        return 2
    receivers = open_receivers()
    try:
        if argv[0] == 'list':
            out = [d for r in receivers for d in list_devices(r)]
        else:
            out = set_host(receivers, channels)
    finally:
        for r in receivers:
            r.close()
    print(json.dumps(out))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
