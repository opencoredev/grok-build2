#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install_dir="${GROK2_INSTALL_DIR:-${HOME:?}/.grok/grok2}"
command_dir="${GROK2_BIN_DIR:-${HOME:?}/.local/bin}"
exec ruby "$source_dir/update.rb" install "$install_dir" "$source_dir" "$command_dir"
