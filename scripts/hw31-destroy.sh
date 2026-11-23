#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

bash "$ROOT/scripts/hw31-destroy-demo.sh"
bash "$ROOT/scripts/hw31-destroy-base.sh"

aws_left() {
  local dir="$1" name="$2"
  if ! pulumi stack ls --json --cwd "$dir" | jq -e --arg name "$name" '.[] | select(.name == $name or (.name | endswith("/" + $name)))' >/dev/null; then
    echo 0
    return
  fi
  pulumi stack export --stack "$name" --cwd "$dir" | jq '[.deployment.resources[]? | select(.type | startswith("aws:"))] | length'
}

demo_left="$(aws_left "$ROOT/infra/demo" demo)"
base_left="$(aws_left "$ROOT/infra/base" base)"
left=$((demo_left + base_left))
if [[ "$left" != 0 ]]; then
  echo "після destroy лишилось aws-ресурсів: demo=${demo_left} base=${base_left}" >&2
  exit 1
fi
demos="$ROOT/evidence/demos.txt"
touch "$demos"
if ! grep -qx 'state-resources-left=0' "$demos"; then
  printf '%s\n' 'state-resources-left=0' >> "$demos"
fi
