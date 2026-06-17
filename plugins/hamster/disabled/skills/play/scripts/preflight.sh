#!/usr/bin/env bash
# preflight.sh — verify the machine + config can run hamster.
# Checks: macOS 15+, iPhone Mirroring app present, config/token present.
# Exits 0 if good. Exits 2 if config missing (with setup help). Exits 1 otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

fail=0

# 1) macOS version >= 15.
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: hamster requires macOS (this is not a Mac)." >&2
  fail=1
else
  os_ver="$(sw_vers -productVersion 2>/dev/null || echo "0")"
  major="${os_ver%%.*}"
  if [[ -z "$major" || ! "$major" =~ ^[0-9]+$ || "$major" -lt 15 ]]; then
    echo "ERROR: macOS 15 (Sequoia) or newer is required for iPhone Mirroring. Found: $os_ver" >&2
    fail=1
  else
    echo "OK: macOS $os_ver"
  fi
fi

# 2) iPhone Mirroring app present.
if [[ -d "/System/Applications/iPhone Mirroring.app" ]]; then
  echo "OK: iPhone Mirroring app found"
else
  echo "ERROR: iPhone Mirroring.app not found at /System/Applications/. Requires macOS 15+ (not available in the EU)." >&2
  fail=1
fi

# 3) Config / token present. require_token exits 2 with setup help if missing.
require_token
echo "OK: Hamster config present (API: $HAMSTER_API_URL)"

if [[ "$fail" -ne 0 ]]; then
  echo "Preflight failed. See errors above." >&2
  exit 1
fi

echo "Preflight passed."
