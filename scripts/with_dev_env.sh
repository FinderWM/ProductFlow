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
if [[ "${STORAGE_BACKEND:-}" == "minio" || "${STORAGE_BACKEND:-}" == "s3" ]]; then
  export S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-http://localhost:${MINIO_API_PORT:-19000}}"
  export STORAGE_PUBLIC_BASE_URL="${STORAGE_PUBLIC_BASE_URL:-http://localhost:${MINIO_API_PORT:-19000}}"
  export S3_BUCKET="${S3_BUCKET:-${MINIO_BUCKET:-}}"
  export S3_ACCESS_KEY="${S3_ACCESS_KEY:-${MINIO_APP_ACCESS_KEY:-}}"
  export S3_SECRET_KEY="${S3_SECRET_KEY:-${MINIO_APP_SECRET_KEY:-}}"
  export S3_REGION="${S3_REGION:-${MINIO_REGION:-us-east-1}}"
fi
exec "$@"
