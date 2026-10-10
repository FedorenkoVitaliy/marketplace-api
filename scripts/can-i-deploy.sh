#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

URL="${PACT_BROKER_URL:-http://127.0.0.1:21620}"
VERSION="${GIT_COMMIT:-1.0.0}"
PACT="$ROOT/pacts/marketplace-web-marketplace-api.json"
test -f "$PACT"

auth=()
if [ -n "${PACT_BROKER_TOKEN:-}" ]; then
  auth+=(-H "Authorization: Bearer ${PACT_BROKER_TOKEN}")
fi

curl -fsS -X PUT ${auth[@]+"${auth[@]}"} -H 'Content-Type: application/json' \
  --data-binary @"$PACT" \
  "$URL/pacts/provider/marketplace-api/consumer/marketplace-web/version/$VERSION" \
  -o /dev/null

export PACT_BROKER_URL="$URL"
export GIT_COMMIT="$VERSION"
node dist/test/verify-broker.js

curl -fsS -X PUT ${auth[@]+"${auth[@]}"} -H 'Content-Type: application/json' \
  "$URL/pacticipants/marketplace-api/versions/$VERSION/tags/prod" \
  -o /dev/null

body="$(mktemp)"
curl -fsS ${auth[@]+"${auth[@]}"} \
  "$URL/can-i-deploy?pacticipant=marketplace-web&version=$VERSION&to=prod" \
  -o "$body"
cat "$body"
node --input-type=module -e '
import { readFileSync } from "node:fs";
const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (body.summary?.deployable !== true) process.exit(1);
' "$body"
