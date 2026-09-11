#!/usr/bin/env bash
# 1. ALTER ROLE у БД → 2. файл-секрет → 3. закрити старі зʼєднання app_user.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE у Postgres…"
docker compose exec -T db psql -U admin -d marketplace \
  -c "ALTER ROLE app_user WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Оновлюю файл-секрет…"
printf '%s' "${NEW_PASSWORD}" > secrets/db_password

echo "3. Закриваю старі зʼєднання app_user…"
docker compose exec -T db psql -U admin -d marketplace -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'app_user';"

echo "Готово: новий пароль уже в БД і у файлі. Застосунок не рестартуй — curl /db."
