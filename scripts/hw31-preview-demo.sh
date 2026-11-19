#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

grep -q 'http://127.0.0.1:23166' "$ROOT/infra/demo/Pulumi.demo.yaml"
dir="$ROOT/infra/demo"
out="$ROOT/evidence/preview-demo.txt"
pulumi stack select demo --create --non-interactive --cwd "$dir"
pulumi preview --json --non-interactive --stack demo --cwd "$dir" > "$out" 2>&1
grep -qE 'aws:rds/instance:Instance' "$out"
if grep -q 'secure:' "$dir/Pulumi.demo.yaml"; then
  echo "у Pulumi.demo.yaml зʼявився secure:" >&2
  exit 1
fi
