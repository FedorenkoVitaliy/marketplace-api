#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

dir="$ROOT/infra/demo"
if ! pulumi stack ls --json --cwd "$dir" | jq -e '.[] | select(.name == "demo" or (.name | endswith("/demo")))' >/dev/null; then
  exit 0
fi
pulumi cancel --yes --stack demo --cwd "$dir" >/dev/null 2>&1 || true
pulumi destroy --yes --non-interactive --stack demo --cwd "$dir"
