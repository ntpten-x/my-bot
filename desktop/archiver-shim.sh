#!/usr/bin/env bash
# PATH shim for file-roller / xarchiver so PCManFM Extract Here never opens a hanging GUI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
EXTRACT="$ROOT/extract-archive.sh"
[[ -x "$EXTRACT" ]] || EXTRACT="$(command -v extract-archive.sh || true)"
[[ -n "${EXTRACT:-}" && -x "$EXTRACT" ]] || { echo "extract-archive.sh missing" >&2; exit 1; }

# Translate common libfm command lines into the non-interactive extractor.
# file-roller may pass file:// URIs (%U); xarchiver usually passes paths (%F).
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

args=("$@")
if [[ ${#args[@]} -eq 0 ]]; then
  exec "$EXTRACT" --help
fi

# file-roller: --extract %U | --extract-to %d %U
# xarchiver:   --extract %F | --extract-to %d %F
mode=""
dest=""
files=()
i=0
while [[ $i -lt ${#args[@]} ]]; do
  a="${args[$i]}"
  case "$a" in
    --extract|-e)
      mode=extract
      ;;
    --extract-to)
      mode=extract_to
      i=$((i + 1))
      dest="$(normalize_path "${args[$i]:-}")"
      ;;
    --extract-to=*)
      mode=extract_to
      dest="$(normalize_path "${a#--extract-to=}")"
      ;;
    --destination)
      mode=extract_to
      i=$((i + 1))
      dest="$(normalize_path "${args[$i]:-}")"
      ;;
    --add|--compress|--batch|--dialog|--new)
      # Create/GUI paths are unused on the bot desktop; refuse instead of hanging.
      echo "archive create/GUI is disabled on MY-BOT desktop; use unzip or Extract Here" >&2
      exit 1
      ;;
    -*)
      ;;
    *)
      files+=("$(normalize_path "$a")")
      ;;
  esac
  i=$((i + 1))
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "no archive path provided" >&2
  exit 2
fi
if [[ "$mode" == "extract_to" && -n "$dest" ]]; then
  exec "$EXTRACT" --extract-to "$dest" "${files[@]}"
fi
exec "$EXTRACT" --extract "${files[@]}"
