#!/usr/bin/env bash
# Non-interactive archive extract for PCManFM "Extract Here".
# libfm prefers file-roller/xarchiver; those GUIs hang under the bot Xvfb session.
set -euo pipefail

usage() {
  echo "usage: extract-archive.sh --extract|--extract-to <dir> <archive>..." >&2
  exit 2
}

# libfm/file-roller may pass file:// URIs; unzip/tar need real paths.
percent_decode() {
  local raw="$1" out="" hex
  while [[ -n "$raw" ]]; do
    case "$raw" in
      %[0-9A-Fa-f][0-9A-Fa-f]*)
        hex="${raw:1:2}"
        printf -v out '%s\x'"$hex" "$out"
        raw="${raw:3}"
        ;;
      *)
        out+="${raw:0:1}"
        raw="${raw:1}"
        ;;
    esac
  done
  printf '%s' "$out"
}

normalize_path() {
  local raw="$1"
  if [[ "$raw" == file://* ]]; then
    raw="${raw#file://}"
    raw="${raw#localhost}"
    # file:///C:/path -> C:/path (common on Windows hosts / Git Bash tests)
    if [[ "$raw" =~ ^/[A-Za-z]:/ ]]; then
      raw="${raw:1}"
    fi
    if command -v python3 >/dev/null 2>&1 && python3 -c 'import urllib.parse' >/dev/null 2>&1; then
      raw="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$raw")"
    else
      raw="$(percent_decode "$raw")"
    fi
  fi
  printf '%s' "$raw"
}

archive_basename() {
  local name
  name="$(basename "$1")"
  name="${name%.ZIP}"
  name="${name%.zip}"
  name="${name%.JAR}"
  name="${name%.jar}"
  name="${name%.APK}"
  name="${name%.apk}"
  name="${name%.XPI}"
  name="${name%.xpi}"
  name="${name%.tar.gz}"
  name="${name%.tgz}"
  name="${name%.tar.bz2}"
  name="${name%.tbz2}"
  name="${name%.tar.xz}"
  name="${name%.txz}"
  name="${name%.TAR}"
  name="${name%.tar}"
  name="${name%.GZ}"
  name="${name%.gz}"
  printf '%s' "$name"
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
      dest="$(normalize_path "${2:-}")"
      shift 2
      ;;
    --add|--compress|--batch|--dialog|--destination)
      # Ignore create/GUI flags from libfm/file-roller/xarchiver command lines.
      if [[ "${1}" == "--destination" || "${1}" == "--extract-to" ]]; then
        dest="$(normalize_path "${2:-}")"
        shift 2
      else
        shift
      fi
      ;;
    --*)
      shift
      ;;
    *)
      files+=("$(normalize_path "$1")")
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
    # Extract Here: always create/update a sibling folder named after the zip so
    # the file manager shows a new entry instead of silently overwriting contents.
    local_parent="$(cd "$(dirname "$archive")" && pwd)"
    out_dir="$local_parent/$(archive_basename "$archive")"
  fi
  extract_one "$archive" "$out_dir"
done
