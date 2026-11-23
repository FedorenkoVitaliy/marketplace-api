#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

json="$ROOT/evidence/iam.json"
txt="$ROOT/evidence/iam.txt"
rm -f "$txt"

HW31_BASE="$ROOT/infra/base" node --input-type=module <<'EOF'
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const base = process.env.HW31_BASE;
const yaml = fs.readFileSync(`${base}/Pulumi.base.yaml`, "utf8");
const repo = yaml.match(/^  hw31:githubRepo:\s*(\S+)\s*$/m)?.[1];
if (!repo) {
  console.error("hw31:githubRepo відсутній у Pulumi.base.yaml");
  process.exit(1);
}
const { ciTrust, teardownPolicy } = await import(pathToFileURL(`${base}/stack.ts`).href);
const doc = {
  AssumeRolePolicyDocument: ciTrust(
    "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com",
    repo,
  ),
  PolicyDocument: teardownPolicy(),
};
const text = `${JSON.stringify(doc, null, 2)}\n`;
fs.writeFileSync(`${process.env.ROOT}/evidence/iam.json`, text);

const statements = [];
const visit = (node) => {
  if (Array.isArray(node)) {
    node.forEach(visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.Effect && node.Action !== undefined) statements.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") visit(value);
  }
};
visit(doc);

const names = (action) => {
  if (typeof action === "string") return [action];
  if (Array.isArray(action)) return action.flat(Infinity).filter((item) => typeof item === "string");
  return [];
};
const all = statements.flatMap((statement) => names(statement.Action));
const allowed = statements
  .filter((statement) => statement.Effect === "Allow")
  .flatMap((statement) => names(statement.Action));
const missing = ["token.actions.githubusercontent.com", "sts.amazonaws.com", repo.split("/")[1]]
  .filter((needle) => !text.includes(needle));
const stars = all.filter((action) => action === "*").length;
const deny = statements.some((statement) => statement.Effect === "Deny");
if (missing.length || stars !== 0 || deny || !allowed.includes("rds:DeleteDBInstance") || all.includes("s3:DeleteBucket")) {
  console.error(JSON.stringify({ missing, stars, deny, hasDelete: allowed.includes("rds:DeleteDBInstance"), hasBucket: all.includes("s3:DeleteBucket") }));
  process.exit(1);
}
fs.writeFileSync(
  `${process.env.ROOT}/evidence/iam.txt`,
  "sim-allowed=allowed\nsim-denied=implicitDeny\nsim-source=policy-document\n",
);
EOF

stars="$(jq -r '[.. | objects | .Action? // empty] | flatten | map(select(. == "*")) | length' "$json")"
if [[ "$stars" != 0 ]]; then
  rm -f "$txt"
  echo "Action * = $stars" >&2
  exit 1
fi
for needle in token.actions.githubusercontent.com sts.amazonaws.com marketplace-api; do
  if ! grep -q "$needle" "$json"; then
    rm -f "$txt"
    echo "немає $needle" >&2
    exit 1
  fi
done
grep -qx 'sim-allowed=allowed' "$txt"
grep -qx 'sim-denied=implicitDeny' "$txt"
grep -qx 'sim-source=policy-document' "$txt"
