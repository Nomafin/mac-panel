#!/bin/sh
# The Mac's Python for hidpp/logi.py: a venv with hidapi. Prints the venv's python.
set -e
VENV="$HOME/.local/share/mac-panel/venv"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade hidapi
echo "$VENV/bin/python"
