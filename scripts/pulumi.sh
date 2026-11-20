#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cmd="${1:?up or destroy}"
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://${ROOT}/.pulumi}"
export PULUMI_SKIP_UPDATE_CHECK=true
mkdir -p "${PULUMI_BACKEND_URL#file://}"
cd "$ROOT/infra"
pulumi stack select hw28 --create --non-interactive
pulumi "$cmd" --yes --non-interactive --stack hw28
