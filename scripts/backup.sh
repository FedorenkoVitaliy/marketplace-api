#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?}"

user="$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$DATABASE_URL")"
pass="$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$DATABASE_URL")"
db="$(node -e "console.log(new URL(process.argv[1]).pathname.replace(/^\//, ''))" "$DATABASE_URL")"

mkdir -p backups
out="$ROOT/backups/marketplace-$(date +%Y-%m-%d-%H%M%S).dump"

docker compose exec -T -e PGPASSWORD="$pass" db \
  pg_dump -U "$user" -d "$db" -Fc > "$out"

echo "$out"
