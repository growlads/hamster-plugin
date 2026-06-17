#!/usr/bin/env bash
# next-game.sh — fetch the best available offer for this user, then record a
# play session and print the session JSON (includes click_url + game).
#
# Usage: next-game.sh [game-name-filter]
#   The optional filter is passed to the backend as a hint; the backend may
#   ignore it. We always fall back to GET /v1/games/next.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

require_token

PLATFORM="${HAMSTER_PLATFORM:-ios}"
COUNTRY="${HAMSTER_COUNTRY:-US}"
FILTER="${1:-}"

# Build the query string for /v1/games/next.
next_path="/v1/games/next?platform=$PLATFORM&country=$COUNTRY"
if [[ -n "$FILTER" ]]; then
  # URL-encode the filter with python3 if available; else pass raw.
  if command -v python3 >/dev/null 2>&1; then
    enc="$(printf '%s' "$FILTER" | python3 -c 'import sys,urllib.parse;sys.stdout.write(urllib.parse.quote(sys.stdin.read()))' 2>/dev/null || printf '%s' "$FILTER")"
  else
    enc="$FILTER"
  fi
  next_path="$next_path&q=$enc"
fi

# 1) Get the next/best game.
next_resp="$(api_get "$next_path")" || {
  echo "ERROR: failed to fetch a game from $HAMSTER_API_URL$next_path" >&2
  echo "Check that the backend is running and your token is valid." >&2
  exit 1
}

# Extract the offer_id so we can open a session.
offer_id="$(json_field "$next_resp" "offer_id")"
if [[ -z "$offer_id" ]]; then
  echo "ERROR: no offer_id in /v1/games/next response. Raw response:" >&2
  echo "$next_resp" >&2
  echo "There may be no rewarded offers available for platform=$PLATFORM country=$COUNTRY right now." >&2
  exit 1
fi

# 2) Record the play intent → returns session_id, click_url, game.
session_body="{\"offer_id\": \"$offer_id\"}"
session_resp="$(api_post "/v1/sessions" "$session_body")" || {
  echo "ERROR: failed to create a session for offer_id=$offer_id" >&2
  exit 1
}

# Print the raw session JSON for Claude to read (contains click_url + game).
printf '%s\n' "$session_resp"
