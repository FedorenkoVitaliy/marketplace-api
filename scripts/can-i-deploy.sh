#!/usr/bin/env bash
set -euo pipefail
URL="${PACT_BROKER_URL:-http://127.0.0.1:21620}"
# Гейт консюмера: чи можна випускати marketplace-web у prod
# (потрібен перевірений контракт із версією marketplace-api, позначеною тегом prod).
PACTICIPANT="${PACTICIPANT:-marketplace-web}"
VERSION="${CONSUMER_VERSION:-1.0.0}"
auth=()
if [ -n "${PACT_BROKER_TOKEN:-}" ]; then
  auth+=(-H "Authorization: Bearer ${PACT_BROKER_TOKEN}")
fi
body="$(mktemp)"
curl -fsS ${auth[@]+"${auth[@]}"} \
  "$URL/can-i-deploy?pacticipant=${PACTICIPANT}&version=${VERSION}&to=prod" \
  -o "$body"
cat "$body"
node --input-type=module -e '
import { readFileSync } from "node:fs";
const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (body.summary?.deployable !== true) process.exit(1);
' "$body"
