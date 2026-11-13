#!/usr/bin/env bash
set -euo pipefail
IMAGE="${IMAGE:-marketplace-api:hw28}"
MAX="${SCAN_MAX:?SCAN_MAX is required}"
REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:0.74.0 \
  image --quiet --scanners vuln --format json "$IMAGE" > "$REPORT"
node --input-type=module - "$REPORT" "$IMAGE" "$MAX" <<'JS'
import { readFileSync } from 'node:fs';
const [report, image, maxRaw] = process.argv.slice(2);
const max = Number(maxRaw);
const body = JSON.parse(readFileSync(report, 'utf8'));
const severity = 'CRITICAL,HIGH';
const wanted = new Set(severity.split(','));
let found = 0;
for (const result of body.Results ?? []) {
  for (const vuln of result.Vulnerabilities ?? []) {
    if (wanted.has(String(vuln.Severity))) found += 1;
  }
}
const gate = Number.isFinite(max) && found <= max ? 'pass' : 'fail';
console.log(`image=${image}`);
console.log(`severity=${severity}`);
console.log(`found=${found}`);
console.log(`max-allowed=${max}`);
console.log(`gate=${gate}`);
process.exit(gate === 'pass' ? 0 : 1);
JS
