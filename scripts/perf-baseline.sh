#!/usr/bin/env bash
# Measures dashboard-critical endpoints. Usage: BASE=http://localhost:5050/api/v1 ./scripts/perf-baseline.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-http://localhost:5050/api/v1}"
EMAIL="${EMAIL:-$(grep -E '^SEED_ADMIN_EMAIL=' .env | cut -d= -f2- | tr -d '"')}"
PASSWORD="${PASSWORD:-$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2- | tr -d '"')}"

login_time() {
  curl -s -o /tmp/perf-login.json -w '%{time_total}' -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
}

echo "== login (3 runs, seconds)"
for _ in 1 2 3; do login_time; echo; done

TOKEN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/perf-login.json","utf8")).data.tokens.accessToken)')

measure() {
  local path="$1"
  local out
  out=$(curl -s -o /tmp/perf-body.json -w '%{time_total} %{size_download}' \
    -H "Authorization: Bearer $TOKEN" "$BASE$path")
  printf '%-46s %ss %sB\n' "$path" ${out% *} ${out#* }
}

echo "== endpoints (seconds, bytes)"
for path in \
  '/auth/me' \
  '/dashboard/summary' \
  '/projects?page=1&limit=100' \
  '/shoots?page=1&limit=100' \
  '/team?page=1&limit=100' \
  '/tasks?page=1&limit=100' \
  '/me/todos?page=1&limit=50' \
  '/attendance?page=1&limit=100' \
  '/notifications?page=1&limit=20'
do measure "$path"; done
