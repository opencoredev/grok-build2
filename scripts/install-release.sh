#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install_dir="${GROK2_INSTALL_DIR:-${HOME:?}/.grok/grok2}"
command_dir="${GROK2_BIN_DIR:-${HOME:?}/.local/bin}"
test -x "$source_dir/xai-grok-pager"
test -f "$source_dir/grok2"
mkdir -p "$install_dir" "$command_dir"
install_dir="$(cd -- "$install_dir" && pwd -P)"
command_dir="$(cd -- "$command_dir" && pwd -P)"
if [[ "$install_dir" == "$command_dir" ]]; then
  printf 'Install and command directories must differ.\n' >&2
  exit 1
fi

stage="$(mktemp -d "$install_dir/.install.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
for file in xai-grok-pager grok2; do
  cp "$source_dir/$file" "$stage/$file"
  chmod 755 "$stage/$file"
  if [[ -e "$install_dir/$file" ]]; then
    cp -p "$install_dir/$file" "$install_dir/$file.previous"
  fi
  mv -f "$stage/$file" "$install_dir/$file"
done
for command_name in grok grok2; do
  if [[ -e "$command_dir/$command_name" || -L "$command_dir/$command_name" ]]; then
    cp -P "$command_dir/$command_name" "$stage/$command_name.previous"
    mv -f "$stage/$command_name.previous" "$command_dir/$command_name.previous"
  fi
  ln -s "$install_dir/grok2" "$stage/$command_name.link"
  mv -f "$stage/$command_name.link" "$command_dir/$command_name"
done
printf 'Installed Grok Build 2. Add %s to PATH.\n' "$command_dir"
printf 'Existing sessions are unchanged. Restart them to load the new binary.\n'
printf 'CLIProxyAPI must already be installed and configured. Run grok2 check.\n'
