#!/usr/bin/env bash
# Non-interactive archive extract for PCManFM "Extract Here".
# libfm prefers file-roller/xarchiver; those GUIs hang under the bot Xvfb session.
set -euo pipefail

usage() {
  echo "usage: extract-archive.sh --extract|--extract-to <dir> <archive>..." >&2
  exit 2
}

mode=""
dest=""
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extract|-e)
      mode=extract
      shift
      ;;
    --extract-to|--extract_to|-x)
      mode=extract_to
      dest="${2:-}"
      shift 2
      ;;
    --add|--compress|--batch|--dialog|--destination)
      # Ignore create/GUI flags from libfm/file-roller/xarchiver command lines.
      if [[ "${1}" == "--destination" || "${1}" == "--extract-to" ]]; then
        dest="${2:-}"
        shift 2
      else
        shift
      fi
      ;;
    --*)
      shift
      ;;
    *)
      files+=("$1")
      shift
      ;;
  esac
done

[[ ${#files[@]} -gt 0 ]] || usage
[[ -n "$mode" ]] || mode=extract

extract_one() {
  local archive="$1"
  local out="$2"
  [[ -f "$archive" ]] || { echo "archive not found: $archive" >&2; return 1; }
  mkdir -p "$out"
  case "${archive,,}" in
    *.zip|*.jar|*.apk|*.xpi)
      command -v unzip >/dev/null 2>&1 || { echo "unzip is required" >&2; return 1; }
      unzip -o -q "$archive" -d "$out"
      ;;
    *.tar)
      tar -xf "$archive" -C "$out"
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$out"
      ;;
    *.tar.bz2|*.tbz2)
      tar -xjf "$archive" -C "$out"
      ;;
    *.tar.xz|*.txz)
      tar -xJf "$archive" -C "$out"
      ;;
    *.gz)
      local base
      base="$(basename "$archive" .gz)"
      gzip -dc "$archive" >"$out/$base"
      ;;
    *)
      echo "unsupported archive type: $archive" >&2
      return 1
      ;;
  esac
}

for archive in "${files[@]}"; do
  out_dir="$dest"
  if [[ "$mode" == "extract" || -z "$out_dir" ]]; then
    out_dir="$(cd "$(dirname "$archive")" && pwd)"
  fi
  extract_one "$archive" "$out_dir"
done
