#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 20 LTS from https://nodejs.org then rerun this script."
  exit 1
fi

major="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$major" -lt 20 ]; then
  echo "Node 20 or newer is required."
  exit 1
fi

npm install
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

read_secret() {
  printf "Optional %s (Enter to skip): " "$1"
  stty -echo
  read -r value
  stty echo
  printf "\n"
  printf "%s" "$value"
}

set_env() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {$0=k"=\"" v "\""} {print}' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '%s="%s"\n' "$key" "$value" >> .env
  fi
}

groq="$(read_secret GROQ_API_KEY)"
[ -n "$groq" ] && set_env GROQ_API_KEY "$groq"
gemini="$(read_secret GEMINI_API_KEY)"
[ -n "$gemini" ] && set_env GEMINI_API_KEY "$gemini"
discord="$(read_secret DISCORD_WEBHOOK_URL)"
[ -n "$discord" ] && set_env DISCORD_WEBHOOK_URL "$discord"

# Database: Supabase Postgres. Ask once when .env has no postgres DATABASE_URL yet.
if ! grep -Eq '^DATABASE_URL="?postgres(ql)?://' .env || grep -q 'YOUR-PASSWORD' .env; then
  echo "Supabase: Project > Connect > Connection string > Transaction pooler (port 6543)."
  printf "Paste it (it may still contain [YOUR-PASSWORD]): "
  read -r pooler
  pooler="${pooler%\"}"; pooler="${pooler#\"}"
  case "$pooler" in postgres://*|postgresql://*) ;; *) echo "Not a postgresql:// connection string"; exit 1 ;; esac
  if printf '%s' "$pooler" | grep -q '\[YOUR-PASSWORD\]'; then
    pw="$(read_secret 'Supabase database password')"
    [ -n "$pw" ] || { echo "The database password is required."; exit 1; }
    pw_enc="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$pw")"
    pooler="$(printf '%s' "$pooler" | sed "s|\[YOUR-PASSWORD\]|$pw_enc|")"
  fi
  base="${pooler%%\?*}"
  set_env DATABASE_URL "$base?pgbouncer=true&connection_limit=5"
  set_env DIRECT_URL "$(printf '%s' "$base" | sed 's|:6543/|:5432/|')"
  echo "Saved DATABASE_URL and DIRECT_URL to .env (not shown)."
fi

npx prisma migrate deploy
npx tsx prisma/seed.ts

if command -v ollama >/dev/null 2>&1; then
  echo "Chat model: 1) qwen2.5:7b  2) qwen2.5:3b"
  read -r choice
  if [ "$choice" = "2" ]; then chat="qwen2.5:3b"; else chat="qwen2.5:7b"; fi
  ollama pull "$chat" || true
  ollama pull bge-m3 || true
  set_env OLLAMA_MODEL "$chat"
  set_env OLLAMA_BASE_URL "http://127.0.0.1:11434"
else
  echo "Ollama is not installed. Install it from https://ollama.com if you want local models."
fi

set_env PORT "8001"
npm run build
echo "Extension token: open http://localhost:8001/settings after you set the owner password."
echo "Load the extension folder in Chrome, then open http://localhost:8001"
echo "Guide: docs/SETUP.th.md"
