#!/usr/bin/env bash
set -euo pipefail
export PGPASSWORD="${DB_PASSWORD:-admin-bootstrap-only}"
while true; do
  clear
  echo "PgBouncer зараз ($(date +%H:%M:%S)). Ctrl+C — вийти"
  echo
  psql -h 127.0.0.1 -p 6432 -U "${DB_USER:-admin}" -d pgbouncer -At -F'|' -c "SHOW POOLS" \
    | awk -F'|' 'BEGIN { printf "%-12s %10s %11s %10s %8s %8s %12s\n", "база", "cl_active", "cl_waiting", "sv_active", "sv_idle", "maxwait", "pool_mode" }
                 $1 == "marketplace" { printf "%-12s %10s %11s %10s %8s %8s %12s\n", $1 " (" $2 ")", $3, $4, $7, $10, $14 "s", $16 }'
  echo
  echo "cl_active  — клієнти, яким зараз дали з'єднання з Postgres"
  echo "cl_waiting — клієнти в черзі, чекають вільне з'єднання"
  echo "sv_active  — справжні з'єднання з Postgres, що працюють (стеля = default_pool_size)"
  echo "maxwait    — скільки секунд чекає найдовший у черзі"
  sleep 0.5
done
