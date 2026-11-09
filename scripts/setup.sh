#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Install a supported Node.js LTS from https://nodejs.org then rerun this script."
  exit 1
fi

# Match the installed test toolchain's engines, not just the app's runtime floor.
if ! node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit((a>=26 || (a===24 && b>=15) || (a===22 && (b>22 || (b===22 && c>=2))))?0:1)'; then
  echo "Node 22.22.2+, 24.15.0+, or 26+ is required by the locked test dependencies."
  exit 1
fi

umask 077
npm ci
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

read_secret() {
  local value=""
  printf "Optional %s (Enter to skip): " "$1" >&2
  if [ -t 0 ]; then
    IFS= read -r -s value || return 1
  else
    IFS= read -r value || return 1
  fi
  printf "\n" >&2
  printf "%s" "$value"
}

set_env() {
  # Values travel over stdin, never argv, shell interpolation or awk replacement strings.
  printf '%s' "$2" | node scripts/set-env.mjs "$1"
}

discord="$(read_secret DISCORD_WEBHOOK_URL)"
[ -n "$discord" ] && set_env DISCORD_WEBHOOK_URL "$discord"
master="$(read_secret AI_KEY_SECRET)"
if [ -n "$master" ]; then
  [ "${#master}" -ge 16 ] || { echo "AI_KEY_SECRET must contain at least 16 characters." >&2; exit 1; }
  set_env AI_KEY_SECRET "$master"
fi

# Database: Supabase Postgres. Ask once when .env has no postgres DATABASE_URL yet.
if ! grep -Eq '^DATABASE_URL="?postgres(ql)?://' .env || grep -q 'YOUR-PASSWORD' .env; then
  echo "Supabase: Project > Connect > Connection string > Transaction pooler (port 6543)."
  printf "Paste it (it may still contain [YOUR-PASSWORD]): "
  IFS= read -r -s pooler
  printf "\n" >&2
  pooler="${pooler%\"}"; pooler="${pooler#\"}"
  case "$pooler" in postgres://*|postgresql://*) ;; *) echo "Not a postgresql:// connection string"; exit 1 ;; esac
  if printf '%s' "$pooler" | grep -q '\[YOUR-PASSWORD\]'; then
    pw="$(read_secret 'Supabase database password')"
    [ -n "$pw" ] || { echo "The database password is required."; exit 1; }
    pw_enc="$(printf '%s' "$pw" | node -e 'let v="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>v+=c);process.stdin.on("end",()=>process.stdout.write(encodeURIComponent(v)))')"
    pooler="${pooler/'[YOUR-PASSWORD]'/$pw_enc}"
  fi
  urls="$(printf '%s' "$pooler" | node scripts/database-urls.mjs)"
  set_env DATABASE_URL "${urls%%$'\n'*}"
  set_env DIRECT_URL "${urls#*$'\n'}"
  echo "Saved DATABASE_URL and DIRECT_URL to .env (not shown)."
fi

npx prisma migrate deploy
npx tsx prisma/seed.ts

npm run build
echo "Extension token: open http://localhost:8001/settings after you set the owner password."
echo "Load the extension folder in Chrome, then open http://localhost:8001"
echo "Guide: docs/SETUP.th.md"
