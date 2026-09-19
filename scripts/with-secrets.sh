#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi
CREDS="$ROOT/.secrets/infisical.env"
exec infisical run --env="$ENV_SLUG" -- "$@"