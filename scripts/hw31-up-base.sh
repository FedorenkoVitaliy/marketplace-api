#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

grep -q 'http://127.0.0.1:23166' "$ROOT/infra/base/Pulumi.base.yaml"
curl -fsS "$EP/_localstack/health" >/dev/null

dir="$ROOT/infra/base"
pulumi stack select base --create --non-interactive --cwd "$dir"
pulumi cancel --yes --stack base --cwd "$dir" || true
# Community-образ відповідає 501 на budgets. Решта стеку створюється попри цю помилку.
set +e
pulumi up --yes --non-interactive --refresh --continue-on-error --stack base --cwd "$dir"
code=$?
set -e
pulumi stack output vpcId --stack base --cwd "$dir" >/dev/null
pulumi stack export --stack base --cwd "$dir" > "$ROOT/evidence/base-state.json"

vpc_out="$(pulumi stack output vpcId --stack base --cwd "$dir")"
public_ids="$(pulumi stack output publicSubnetIds --json --stack base --cwd "$dir")"
private_ids="$(pulumi stack output privateSubnetIds --json --stack base --cwd "$dir")"
vpc="$(aws_local ec2 describe-vpcs --vpc-ids "$vpc_out" --query 'Vpcs[0].VpcId' --output text)" || exit 1
subs="$(aws_local ec2 describe-subnets --filters "Name=vpc-id,Values=${vpc}")"
rts="$(aws_local ec2 describe-route-tables --filters "Name=vpc-id,Values=${vpc}")"
sgs="$(aws_local ec2 describe-security-groups --filters "Name=vpc-id,Values=${vpc}" --query 'length(SecurityGroups)' --output text)"

public="$(jq -n --argjson ids "$public_ids" --argjson subs "$subs" '[ $subs.Subnets[] | select(.SubnetId as $id | $ids | index($id)) ] | length')"
private="$(jq -n --argjson ids "$private_ids" --argjson subs "$subs" '[ $subs.Subnets[] | select(.SubnetId as $id | $ids | index($id)) ] | length')"
azs="$(jq -n --argjson public "$public_ids" --argjson private "$private_ids" --argjson subs "$subs" '
  ($public + $private) as $ids
  | [ $subs.Subnets[] | select(.SubnetId as $id | $ids | index($id)) | .AvailabilityZone ]
  | map(select(. != null and . != "")) | unique | length')"
private_default="$(jq -n --argjson ids "$private_ids" --argjson rts "$rts" '
  [ $rts.RouteTables[]
    | select(any(.Associations[]?; .SubnetId as $subnet | $subnet != null and ($ids | index($subnet))))
    | .Routes[]?
    | select(.DestinationCidrBlock == "0.0.0.0/0")
  ] | length')"

tagged_api="$(aws_local resourcegroupstaggingapi get-resources \
  --tag-filters Key=Project,Values=nodejs-pro-hw31 \
  --query 'length(ResourceTagMappingList)' --output text 2>/dev/null || true)"
if [[ "$tagged_api" =~ ^[0-9]+$ && "$tagged_api" != 0 ]]; then
  tagged="$tagged_api"
else
  tagged="$(jq '
    [ .deployment.resources[]?
      | . as $resource
      | ($resource.outputs.tagsAll.Project // $resource.outputs.tags.Project // $resource.inputs.tags.Project // empty)
      | select(. == "nodejs-pro-hw31")
    ] | length
  ' "$ROOT/evidence/base-state.json")"
fi

cat > "$ROOT/evidence/base.txt" <<EOF
vpc-id=${vpc}
public-subnets=${public}
private-subnets=${private}
subnet-azs=${azs}
private-default-route=${private_default}
security-groups=${sgs}
tagged-resources=${tagged}
EOF

fail=0
[[ "$vpc" =~ ^vpc-[0-9a-f]+$ ]] || fail=1
[[ "$public" == 2 && "$private" == 2 && "$azs" == 2 && "$private_default" == 0 ]] || fail=1
[[ "$sgs" =~ ^[0-9]+$ && "$sgs" -ge 2 ]] || fail=1
[[ "$tagged" =~ ^[0-9]+$ && "$tagged" -ge 8 ]] || fail=1
if [[ "$fail" != 0 ]]; then
  echo "підрахунки base не зійшлися" >&2
  cat "$ROOT/evidence/base.txt" >&2
  exit 1
fi
