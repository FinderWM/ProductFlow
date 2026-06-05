#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
shared_env_dir="${PRODUCTFLOW_SHARED_ENV_DIR:-/Users/yunlong/project/self/env}"
if [[ -f "$shared_env_dir/minio.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$shared_env_dir/minio.env"
  set +a
fi
if [[ -f "$repo_root/.env.dev" ]]; then
  set -a
  . "$repo_root/.env.dev"
  set +a
fi

detect_productflow_local_ip() {
  local interface=""
  local detected_ip=""
  if command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$interface" ]]; then
      detected_ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$detected_ip" ]] && command -v ip >/dev/null 2>&1; then
    detected_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
  fi
  if [[ -z "$detected_ip" ]] && command -v hostname >/dev/null 2>&1; then
    detected_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$detected_ip"
}

if [[ "${STORAGE_BACKEND:-}" == "minio" || "${STORAGE_BACKEND:-}" == "s3" ]]; then
  minio_api_port="${MINIO_API_PORT:-19000}"
  export S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-http://localhost:${minio_api_port}}"
  if [[ -z "${STORAGE_PUBLIC_BASE_URL:-}" ]]; then
    productflow_local_ip="${PRODUCTFLOW_LOCAL_IP:-}"
    if [[ -z "$productflow_local_ip" ]]; then
      productflow_local_ip="$(detect_productflow_local_ip || true)"
    fi
    if [[ -n "$productflow_local_ip" ]]; then
      export PRODUCTFLOW_LOCAL_IP="$productflow_local_ip"
      export STORAGE_PUBLIC_BASE_URL="http://${productflow_local_ip}:${minio_api_port}"
    else
      export STORAGE_PUBLIC_BASE_URL="http://localhost:${minio_api_port}"
    fi
  fi
  export S3_BUCKET="${S3_BUCKET:-${MINIO_BUCKET:-}}"
  export S3_ACCESS_KEY="${S3_ACCESS_KEY:-${MINIO_APP_ACCESS_KEY:-}}"
  export S3_SECRET_KEY="${S3_SECRET_KEY:-${MINIO_APP_SECRET_KEY:-}}"
  export S3_REGION="${S3_REGION:-${MINIO_REGION:-us-east-1}}"
fi
exec "$@"
