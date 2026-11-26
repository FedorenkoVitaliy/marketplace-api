#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
owner=$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
name="ghcr.io/${owner}/marketplace-api"
if [ -n "${1:-}" ]; then
  digest="$1"
  case "$digest" in
    sha256:*) ;;
    *)
      echo "очікується sha256:…, отримано ${digest}" >&2
      exit 1
      ;;
  esac
  ref="${name}@${digest}"
  docker pull "$ref"
  load_ref="${name}:promote"
  docker tag "$ref" "$load_ref"
else
  head="$(gh api -H "Accept: application/vnd.github+json" \
    "/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" \
    --jq '.[0].head.sha')"
  if [ -z "$head" ] || [ "$head" = "null" ]; then
    echo "немає голови PR для ${GITHUB_SHA}" >&2
    exit 1
  fi
  load_ref="${name}:${head}"
  docker pull "$load_ref"
  ref="$(docker image inspect --format '{{index .RepoDigests 0}}' "$load_ref")"
  case "$ref" in
    *"@sha256:"*) ;;
    *)
      echo "немає digest для ${load_ref}" >&2
      exit 1
      ;;
  esac
fi
curl -fsSL -o "$RUNNER_TEMP/kind" https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
sudo install -m 755 "$RUNNER_TEMP/kind" /usr/local/bin/kind
curl -fsSL -o "$RUNNER_TEMP/kubectl" https://dl.k8s.io/release/v1.33.0/bin/linux/amd64/kubectl
sudo install -m 755 "$RUNNER_TEMP/kubectl" /usr/local/bin/kubectl
kind create cluster --name hw28 --config "$root/k8s/kind-config.yaml"
kind load docker-image "$load_ref" --name hw28
node=$(docker ps --format '{{.Names}}' | grep 'hw28-control-plane' | head -1)
docker exec "$node" ctr -n k8s.io images tag "$load_ref" "$ref"
# shellcheck disable=SC1091
source "$root/scripts/ci-env.sh"
export IMAGE_REF="$ref"
bash "$root/scripts/pulumi.sh" up
