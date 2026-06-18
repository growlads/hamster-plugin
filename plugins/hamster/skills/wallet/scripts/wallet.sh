#!/usr/bin/env bash
# wallet.sh — fetch the user's earnings/ledger from the backend and print raw JSON.
# All rewards/ledger logic lives on the backend; this just relays GET /v1/stats.
#
# Pagination: the ledger is paged so the wallet skill can offer "show older"
# without an interactive UI. Pass --offset N (and optionally --limit M) to fetch
# an older page; with no args you get the most recent page.
#   wallet.sh                 # newest page
#   wallet.sh --offset 20     # the next-older page
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# common.sh is a sibling so the wallet skill is self-contained — it works when the
# skill dir is symlinked into ~/.claude/skills/ on its own (see install-bare-commands.sh).
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

# Optional --limit / --offset. Validate as non-negative integers so they're safe
# to splice into the query string; ignore anything malformed.
LIMIT=""
OFFSET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)  LIMIT="${2:-}";  shift 2 ;;
    --offset) OFFSET="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

query=""
[[ "$LIMIT"  =~ ^[0-9]+$ ]] && query="limit=$LIMIT"
[[ "$OFFSET" =~ ^[0-9]+$ ]] && query="${query:+$query&}offset=$OFFSET"
path="/v1/stats${query:+?$query}"

require_token

resp="$(api_get "$path")" || {
  echo "ERROR: failed to fetch stats from $HAMSTER_API_URL$path" >&2
  echo "Check that the backend is running and your token is valid." >&2
  exit 1
}

printf '%s\n' "$resp"
