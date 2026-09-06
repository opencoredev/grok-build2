#!/usr/bin/env bash
set -euo pipefail

platform="$(uname -s):$(uname -m)"
case "$platform" in
  Darwin:arm64|Darwin:aarch64|Linux:x86_64|Linux:amd64) ;;
  *)
    printf 'grok2 install: Grok Build 2 supports only Linux x64 and macOS Apple Silicon\n' >&2
    exit 1
    ;;
esac

for command in curl ruby; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'grok2 install: required command not found: %s\n' "$command" >&2
    exit 1
  fi
done

temporary="$(mktemp "${TMPDIR:-/tmp}/grok-build2-install.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
curl -q --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 30 \
  --max-filesize 1048576 \
  --output "$temporary" \
  https://raw.githubusercontent.com/opencoredev/grok-build2/main/scripts/update-release.rb
ruby "$temporary" bootstrap \
  "${GROK2_INSTALL_DIR:-${HOME:?}/.grok/grok2}" \
  "${GROK2_BIN_DIR:-${HOME:?}/.local/bin}"
