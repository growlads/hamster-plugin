#!/usr/bin/env bash
# show-qr.sh — bash handler for the `/qr` UserPromptExpansion hook (macOS/Linux).
#
# Paired with show-qr.ps1; each self-guards on its native OS so exactly one runs
# per platform. On Windows Git Bash, `uname -s` is MINGW*/MSYS*/CYGWIN* and this
# handler no-ops, leaving the PowerShell handler to render.
#
# Fetches the rotating featured game from the backend and renders a QR of its
# monitored go_url, so scanning installs the game attributed to this user.
set -euo pipefail

case "$(uname -s 2>/dev/null)" in
  Darwin | Linux) ;;     # native unix — render here
  *) exit 0 ;;           # Windows (Git Bash) — let show-qr.ps1 handle it
esac

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

CONFIG="${HAMSTER_CONFIG:-$HOME/.hamster/config}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
export HAMSTER_API_URL="${HAMSTER_API_URL:-http://localhost:8787}"
export HAMSTER_TOKEN="${HAMSTER_TOKEN:-}"

if command -v node >/dev/null 2>&1; then
  node "$ROOT/scripts/qr/render-qr.js" --featured
else
  printf '{"decision":"block","reason":"Install Node.js to render the QR inline, then run /qr again."}'
fi
