#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$ROOT/evidence/demos.txt"
line='# межа: failover AZ, живий вимір не на цій смузі'
mkdir -p "$ROOT/evidence"
touch "$out"
if ! grep -qxF "$line" "$out"; then
  printf '%s\n' "$line" >> "$out"
fi
echo 'Живий вимір failover AZ на запасній смузі не робиться: не на цій смузі.'
exit 0
