#!/usr/bin/env bash
# open-hub.sh — bash handler for the `/hub` UserPromptExpansion hook (macOS/Linux).
#
# Opens the player's hub in the default browser. Paired with open-hub.ps1; each
# self-guards on its native OS. The token is read from ~/.hamster/config and
# passed in the URL fragment (#t=...), so it never hits the server's request line
# or logs — the page reads it client-side to call the authenticated API.
set -euo pipefail

case "$(uname -s 2>/dev/null)" in
  Darwin) opener="open" ;;
  Linux)  opener="xdg-open" ;;
  *) exit 0 ;;                 # Windows (Git Bash) — let open-hub.ps1 handle it
esac

CONFIG="${HAMSTER_CONFIG:-$HOME/.hamster/config}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
BASE="${HAMSTER_API_URL:-http://localhost:8787}"
BASE="${BASE%/}"
TOKEN="${HAMSTER_TOKEN:-}"

URL="$BASE/app#t=$TOKEN"

# Fire-and-forget; never block the prompt on the browser launch.
"$opener" "$URL" >/dev/null 2>&1 &

# Show only the base URL to the user — never echo the token.
printf '{"decision":"block","reason":"Opening your hub at %s/app in your browser."}' "$BASE"
