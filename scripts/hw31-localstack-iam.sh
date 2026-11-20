#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hw31-env.sh"

compose=(docker compose -p hw31 -f "$ROOT/localstack/docker-compose.yml")
running=0
flag=""
if docker inspect hw31-localstack >/dev/null 2>&1; then
  running="$(docker inspect -f '{{.State.Running}}' hw31-localstack)"
  flag="$(docker inspect hw31-localstack --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="ENFORCE_IAM"{print $2}')"
fi
if [[ "$running" != "true" || "$flag" != "1" ]]; then
  ENFORCE_IAM=1 "${compose[@]}" up -d --force-recreate
fi
for _ in $(seq 1 60); do
  if curl -fsS "$EP/_localstack/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "$EP/_localstack/health" >/dev/null

user_name="hw31-dev"
if ! aws_local iam get-user --user-name "$user_name" >/dev/null 2>&1; then
  aws_local iam create-user --user-name "$user_name" >/dev/null
fi
key_json="$(aws_local iam create-access-key --user-name "$user_name")"
policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
cat > "$policy" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"*","Resource":"*"}]}
EOF
aws_local iam put-user-policy \
  --user-name "$user_name" \
  --policy-name hw31-deny \
  --policy-document "file://${policy}" >/dev/null

export HW31_DEV_KEY HW31_DEV_SECRET
HW31_DEV_KEY="$(jq -r '.AccessKey.AccessKeyId' <<<"$key_json")"
HW31_DEV_SECRET="$(jq -r '.AccessKey.SecretAccessKey' <<<"$key_json")"
codes="$(cd "$ROOT" && node --input-type=module <<'EOF'
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.EP;
const region = process.env.AWS_REGION;
const bucket = "hw31-iam-bucket";
const client = (accessKeyId, secretAccessKey) => new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const status = async (promise) => {
  try {
    const result = await promise;
    return result.$metadata.httpStatusCode ?? -1;
  } catch (error) {
    return error?.$metadata?.httpStatusCode ?? -1;
  }
};
const admin = client(process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY);
await status(admin.send(new CreateBucketCommand({
  Bucket: bucket,
  CreateBucketConfiguration: { LocationConstraint: region },
})));
await status(admin.send(new PutObjectCommand({ Bucket: bucket, Key: "secret.txt", Body: "hello" })));
const dev = client(process.env.HW31_DEV_KEY, process.env.HW31_DEV_SECRET);
const denyAll = await status(dev.send(new PutObjectCommand({ Bucket: bucket, Key: "denied.txt", Body: "b" })));
const fake = client("TOTALLY_FAKE_KEY_12345", "not-a-secret");
const fakeKey = await status(fake.send(new GetObjectCommand({ Bucket: bucket, Key: "secret.txt" })));
for (const connection of [admin, dev, fake]) connection.destroy();
process.stdout.write(`${denyAll} ${fakeKey}\n`);
EOF
)"
deny_all="${codes%% *}"
fake_key="${codes##* }"
log_lines="$(docker logs hw31-localstack 2>&1 | grep -Eic 'AccessDenied|not authorized|explicit deny|enforc' || true)"
if [[ ! "$deny_all" =~ ^-?[0-9]+$ || ! "$fake_key" =~ ^-?[0-9]+$ || ! "$log_lines" =~ ^[0-9]+$ ]]; then
  echo "нечисловий результат: deny-all=${deny_all} fake-key=${fake_key} enforce-iam-log-lines=${log_lines}" >&2
  exit 1
fi
out="$ROOT/evidence/localstack-iam.txt"
cat > "$out" <<EOF
deny-all=${deny_all}
fake-key=${fake_key}
enforce-iam-log-lines=${log_lines}
EOF
if [[ "$deny_all" != 200 || "$fake_key" != 200 || "$log_lines" != 0 ]]; then
  docker logs hw31-localstack 2>&1 | grep -Ein 'AccessDenied|not authorized|explicit deny|enforc' >&2 || true
  echo "фактичні коди не збіглися з очікуванням ТЗ" >&2
  exit 1
fi
