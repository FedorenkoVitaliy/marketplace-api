#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

dir="$ROOT/infra/base"
if ! pulumi stack ls --json --cwd "$dir" | jq -e '.[] | select(.name == "base" or (.name | endswith("/base")))' >/dev/null; then
  exit 0
fi
pulumi cancel --yes --stack base --cwd "$dir" >/dev/null 2>&1 || true
pulumi destroy --yes --non-interactive --stack base --cwd "$dir"
