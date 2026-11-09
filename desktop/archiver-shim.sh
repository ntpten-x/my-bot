#!/usr/bin/env bash
# PATH shim for file-roller / xarchiver so PCManFM Extract Here never opens a hanging GUI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
EXTRACT="$ROOT/extract-archive.sh"
[[ -x "$EXTRACT" ]] || EXTRACT="$(command -v extract-archive.sh || true)"
[[ -n "${EXTRACT:-}" && -x "$EXTRACT" ]] || { echo "extract-archive.sh missing" >&2; exit 1; }

# Translate common libfm command lines into the non-interactive extractor.
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
      dest="${args[$i]:-}"
      ;;
    --extract-to=*)
      mode=extract_to
      dest="${a#--extract-to=}"
      ;;
    --destination)
      mode=extract_to
      i=$((i + 1))
      dest="${args[$i]:-}"
      ;;
    --add|--compress|--batch|--dialog|--new)
      # Create/GUI paths are unused on the bot desktop; refuse instead of hanging.
      echo "archive create/GUI is disabled on MY-BOT desktop; use unzip or Extract Here" >&2
      exit 1
      ;;
    -*)
      ;;
    *)
      files+=("$a")
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
