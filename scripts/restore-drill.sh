#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?}"

user="$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).username))" "$DATABASE_URL")"
pass="$(node -e "console.log(decodeURIComponent(new URL(process.argv[1]).password))" "$DATABASE_URL")"
db="$(node -e "console.log(new URL(process.argv[1]).pathname.replace(/^\//, ''))" "$DATABASE_URL")"

dump="$(ls -1t "$ROOT"/backups/*.dump | head -1)"
echo "дамп: $dump"

if [ -n "${EPOCHREALTIME:-}" ]; then
  now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo "${t:0:${#t}-3}"; }
else
  now_ms() { perl -MTime::HiRes -e 'printf("%.0f\n", Time::HiRes::time()*1000)'; }
fi

checksum() {
  local has
  has="$(docker compose exec -T -e PGPASSWORD="$pass" "$1" \
    psql -U "$user" -d "$db" -Atc "SELECT to_regclass('public.orders') IS NOT NULL")"
  if [ "$has" = "t" ]; then
    docker compose exec -T -e PGPASSWORD="$pass" "$1" \
      psql -U "$user" -d "$db" -Atc \
      "SELECT count(*)::text || '|' || coalesce(sum(id), 0)::text FROM orders"
  else
    docker compose exec -T -e PGPASSWORD="$pass" "$1" \
      psql -U "$user" -d "$db" -Atc \
      "SELECT count(*)::text || '|0' FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace"
  fi
}

cleanup() {
  docker compose --profile drill rm -sf restore >/dev/null 2>&1 || true
  docker volume rm -f marketplace-pgdata-restore >/dev/null 2>&1 || true
}
trap cleanup EXIT

before="$(checksum db)"
echo "orders до: $before"

cleanup
trap cleanup EXIT
docker compose --profile drill up -d --wait restore

empty="$(docker compose exec -T -e PGPASSWORD="$pass" restore \
  psql -U "$user" -d "$db" -Atc \
  "SELECT count(*) FROM pg_tables WHERE tablename = 'orders'")"
echo "таблиць orders у чистій базі: $empty"
if [ "$empty" != "0" ]; then
  echo "база не порожня"
  exit 1
fi

t0="$(now_ms)"
docker compose exec -T -e PGPASSWORD="$pass" restore \
  pg_restore -U "$user" -d "$db" --no-owner < "$dump"
restore_ms="$(( $(now_ms) - t0 ))"

after="$(checksum restore)"
echo "orders після: $after"
echo "відновлення: $(awk -v ms="$restore_ms" 'BEGIN { printf "%.1f", ms / 1000 }') с"

if [ "$before" = "$after" ]; then
  echo "MATCH"
else
  echo "MISMATCH: $before != $after"
  exit 1
fi
