#!/bin/sh
set -eu
atoms_root=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is required; use the version in .nvmrc.' >&2
  exit 1
fi
case "${1:-help}" in
  bootstrap|doctor) exec node "$atoms_root/scripts/setup.mjs" "$@" ;;
  *) exec node "$atoms_root/scripts/manager.mjs" "$@" ;;
esac
