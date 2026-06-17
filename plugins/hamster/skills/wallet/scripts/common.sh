#!/usr/bin/env bash
# common.sh — config loading + API helpers for hamster.
# Sourced by the other scripts. Defines: HAMSTER_API_URL, HAMSTER_TOKEN,
# and helper functions api_get / api_post.
set -euo pipefail

# This script's own dir (physical path, so it resolves even when the wallet skill
# is symlinked into ~/.claude/skills via install-bare-commands.sh), and from it
# the plugin root — where hamster.defaults and scripts/provision.js live.
HAMSTER_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HAMSTER_PLUGIN_ROOT="$(cd "$HAMSTER_COMMON_DIR/../../.." && pwd -P)"

HAMSTER_CONFIG="${HAMSTER_CONFIG:-$HOME/.hamster/config}"

# Resolution order: env var > ~/.hamster/config > shipped plugin defaults.
# Capture env-provided values first so they win over anything the files set.
_HAMSTER_ENV_API_URL="${HAMSTER_API_URL:-}"
_HAMSTER_ENV_TOKEN="${HAMSTER_TOKEN:-}"

# 1) Shipped defaults (lowest priority) — e.g. the production HAMSTER_API_URL.
[[ -f "$HAMSTER_PLUGIN_ROOT/hamster.defaults" ]] && source "$HAMSTER_PLUGIN_ROOT/hamster.defaults"

# 2) User config overrides the defaults.
[[ -f "$HAMSTER_CONFIG" ]] && source "$HAMSTER_CONFIG"

# 3) Env vars win over both.
[[ -n "$_HAMSTER_ENV_API_URL" ]] && HAMSTER_API_URL="$_HAMSTER_ENV_API_URL"
[[ -n "$_HAMSTER_ENV_TOKEN" ]] && HAMSTER_TOKEN="$_HAMSTER_ENV_TOKEN"

HAMSTER_API_URL="${HAMSTER_API_URL:-}"
HAMSTER_TOKEN="${HAMSTER_TOKEN:-}"

# Strip a trailing slash from the base URL so we can append /v1/... cleanly.
HAMSTER_API_URL="${HAMSTER_API_URL%/}"

# require_token — ensure we have a token. If it's missing, try to self-provision
# once (mint + store a token via provision.js, the same path the SessionStart
# hook uses) and re-read the config. Only if that still yields nothing do we
# print a short hint and exit 2.
require_token() {
  if [[ -z "${HAMSTER_TOKEN:-}" ]] \
    && command -v node >/dev/null 2>&1 \
    && [[ -f "$HAMSTER_PLUGIN_ROOT/scripts/provision.js" ]]; then
    # provision.js resolves the URL itself, is idempotent, and fails soft.
    HAMSTER_API_URL="$HAMSTER_API_URL" node "$HAMSTER_PLUGIN_ROOT/scripts/provision.js" >/dev/null 2>&1 || true
    # Pick up a freshly minted token (env still wins if it was set).
    [[ -f "$HAMSTER_CONFIG" ]] && source "$HAMSTER_CONFIG"
    [[ -n "$_HAMSTER_ENV_TOKEN" ]] && HAMSTER_TOKEN="$_HAMSTER_ENV_TOKEN"
    HAMSTER_TOKEN="${HAMSTER_TOKEN:-}"
    HAMSTER_API_URL="${HAMSTER_API_URL%/}"
  fi

  if [[ -z "${HAMSTER_TOKEN:-}" ]]; then
    cat >&2 <<EOF
hamster couldn't connect automatically.

It normally mints a token for you on first run. This usually means Node.js
(>= 18) isn't on your PATH, or the backend was unreachable. Install Node and
retry, or set a token manually in ~/.hamster/config:

  HAMSTER_TOKEN=<your token>
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
