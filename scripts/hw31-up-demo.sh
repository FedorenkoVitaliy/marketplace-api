#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

grep -q 'http://127.0.0.1:23166' "$ROOT/infra/demo/Pulumi.demo.yaml"
dir="$ROOT/infra/demo"
out="$ROOT/evidence/501.txt"
pulumi stack select demo --create --non-interactive --cwd "$dir"
set +e
pulumi up --yes --non-interactive --stack demo --cwd "$dir" > "$out" 2>&1
code=$?
set -e
bash "$ROOT/scripts/hw31-destroy-demo.sh"
if grep -q 'not included within your LocalStack license' "$out"; then
  exit 0
fi
echo "pulumi up demo завершився без рядка ліцензії, код ${code}" >&2
exit 1
