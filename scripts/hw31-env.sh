export ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
unset AWS_PROFILE || true
export AWS_REGION=eu-central-1
export AWS_DEFAULT_REGION=eu-central-1
export AWS_EC2_METADATA_DISABLED=true
export AWS_PAGER=
unset AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_CREDENTIAL_EXPIRATION || true
export PULUMI_BACKEND_URL="file://${ROOT}/.pulumi-hw31"
export PULUMI_CONFIG_PASSPHRASE="${PULUMI_CONFIG_PASSPHRASE:-hw31-local}"
export PULUMI_SKIP_UPDATE_CHECK=true
export NO_COLOR=1
mkdir -p "${ROOT}/.pulumi-hw31" "${ROOT}/evidence"
export EP="http://127.0.0.1:23166"

aws_local() {
  command aws "$@" --endpoint-url "$EP" --region "$AWS_REGION"
}
