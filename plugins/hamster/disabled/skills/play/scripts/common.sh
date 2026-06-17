#!/usr/bin/env bash
# common.sh — config loading + API helpers for hamster.
# Sourced by the other scripts. Defines: HAMSTER_API_URL, HAMSTER_TOKEN,
# and helper functions api_get / api_post.
set -euo pipefail

HAMSTER_CONFIG="${HAMSTER_CONFIG:-$HOME/.hamster/config}"

# 1) Load the config file first (plain KEY=value shell file), if present.
if [[ -f "$HAMSTER_CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$HAMSTER_CONFIG"
fi

# 2) Env vars override the config file. Default API URL for dev.
HAMSTER_API_URL="${HAMSTER_API_URL:-http://localhost:8787}"
HAMSTER_TOKEN="${HAMSTER_TOKEN:-}"

# Strip a trailing slash from the base URL so we can append /v1/... cleanly.
HAMSTER_API_URL="${HAMSTER_API_URL%/}"

# require_token — ensure we have a token, else print setup help and exit 2.
require_token() {
  if [[ -z "${HAMSTER_TOKEN:-}" ]]; then
    cat >&2 <<EOF
hamster is not configured yet — no HAMSTER_TOKEN found.

Set it up in two steps:

1) Register to mint a user + token (dev/onboarding convenience):

   curl -s -X POST "$HAMSTER_API_URL/v1/register"

   This returns JSON like {"user_id":"...","token":"..."}.

2) Save the token to your config file at ~/.hamster/config:

   mkdir -p ~/.hamster
   cat > ~/.hamster/config <<CONF
   HAMSTER_API_URL=$HAMSTER_API_URL
   HAMSTER_TOKEN=<the token from step 1>
   CONF

You can also export HAMSTER_API_URL / HAMSTER_TOKEN as env vars instead.
EOF
    exit 2
  fi
}

# api_get PATH — GET an authenticated /v1 endpoint, print the raw response body.
api_get() {
  local path="$1"
  curl -fsS \
    -H "Authorization: Bearer $HAMSTER_TOKEN" \
    -H "Accept: application/json" \
    "$HAMSTER_API_URL$path"
}

# api_post PATH [JSON_BODY] — POST an authenticated /v1 endpoint, print raw body.
api_post() {
  local path="$1"
  local body="${2:-}"
  if [[ -n "$body" ]]; then
    curl -fsS \
      -H "Authorization: Bearer $HAMSTER_TOKEN" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -X POST \
      --data "$body" \
      "$HAMSTER_API_URL$path"
  else
    curl -fsS \
      -H "Authorization: Bearer $HAMSTER_TOKEN" \
      -H "Accept: application/json" \
      -X POST \
      "$HAMSTER_API_URL$path"
  fi
}

# json_field JSON KEY — extract a top-level-ish string field by key using python3.
# Best-effort: returns empty string if python3 is missing or the key is absent.
# Searches recursively for the first occurrence of KEY with a string/number value.
json_field() {
  local json="$1" key="$2"
  if command -v python3 >/dev/null 2>&1; then
    # JSON goes in via env: the heredoc occupies stdin as the python script.
    JF_JSON="$json" python3 - "$key" <<'PY' 2>/dev/null || true
import json, os, sys
key = sys.argv[1]
def walk(o):
    if isinstance(o, dict):
        if key in o and not isinstance(o[key], (dict, list)):
            return o[key]
        for v in o.values():
            r = walk(v)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = walk(v)
            if r is not None:
                return r
    return None
try:
    data = json.loads(os.environ.get("JF_JSON", ""))
except Exception:
    sys.exit(0)
r = walk(data)
if r is not None:
    sys.stdout.write(str(r))
PY
  fi
}
