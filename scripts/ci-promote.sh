#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
owner=$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
name="ghcr.io/${owner}/marketplace-api"
if [ -n "${1:-}" ]; then
  ref="${name}@${1}"
else
  ref="${name}:${GITHUB_SHA}"
fi
printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
if ! docker pull "$ref"; then
  echo "promote=skipped"
  exit 0
fi
curl -fsSL -o "$RUNNER_TEMP/kind" https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
sudo install -m 755 "$RUNNER_TEMP/kind" /usr/local/bin/kind
curl -fsSL -o "$RUNNER_TEMP/kubectl" https://dl.k8s.io/release/v1.33.0/bin/linux/amd64/kubectl
sudo install -m 755 "$RUNNER_TEMP/kubectl" /usr/local/bin/kubectl
kind create cluster --name hw28 --config "$root/k8s/kind-config.yaml"
kind load docker-image "$ref" --name hw28
# shellcheck disable=SC1091
source "$root/scripts/ci-env.sh"
export IMAGE_REF="$ref"
bash "$root/scripts/pulumi.sh" up
