"""Send the Logitech keyboard and mouse to a channel through this PC's receiver."""
from hidpp import logi


def host(channels):
    receivers = logi.open_receivers()
    try:
        return logi.set_host(receivers, channels)
    finally:
        for r in receivers:
            r.close()
