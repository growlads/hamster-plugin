#!/usr/bin/env bash
# wallet.sh — fetch the user's earnings/ledger from the backend and print raw JSON.
# All rewards/ledger logic lives on the backend; this just relays GET /v1/stats.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# common.sh is a sibling so the wallet skill is self-contained — it works when the
# skill dir is symlinked into ~/.claude/skills/ on its own (see install-bare-commands.sh).
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

require_token

resp="$(api_get "/v1/stats")" || {
  echo "ERROR: failed to fetch stats from $HAMSTER_API_URL/v1/stats" >&2
  echo "Check that the backend is running and your token is valid." >&2
  exit 1
}

printf '%s\n' "$resp"
