#!/bin/sh
set -eu
atoms_root=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
atoms_python="$atoms_root/.tools/deploy/bin/python"
if [ ! -x "$atoms_python" ]; then
  atoms_python=python3
fi
if ! command -v "$atoms_python" >/dev/null 2>&1; then
  echo 'Python 3.12–3.14 is required for deployment tools.' >&2
  exit 1
fi
exec "$atoms_python" -B "$atoms_root/scripts/deploy.py" "$@"
