#!/usr/bin/env bash
# mirror-open.sh — launch iPhone Mirroring and drive Safari-on-the-phone to
# open a URL (arg 1), so an offerwall attribution click lands ON the device.
#
# This is best-effort and UNVERIFIABLE: there is no Accessibility read-back of
# the mirror content, so we use generous delays and ALWAYS print a manual
# fallback. We never hard-fail here — a session was already created upstream.
#
# Requires: Accessibility permission for the calling process (Terminal / the
# app hosting Claude Code) in System Settings > Privacy & Security > Accessibility.
set -euo pipefail

URL="${1:-}"

print_manual_fallback() {
  echo ""
  echo "================ OPEN THIS ON YOUR iPHONE ================"
  echo "If the game's App Store page did not open automatically on your"
  echo "iPhone, open Safari on the phone and go to this link manually so the"
  echo "install is attributed to you:"
  echo ""
  echo "  $URL"
  echo ""
  if command -v qrencode >/dev/null 2>&1; then
    echo "Or scan this QR code with your iPhone camera:"
    qrencode -t ANSIUTF8 "$URL" || true
    echo ""
  fi
  echo "========================================================="
}

if [[ -z "$URL" ]]; then
  echo "ERROR: mirror-open.sh requires a URL argument." >&2
  exit 1
fi

# If anything below errors, still surface the manual fallback and exit 0 so the
# overall /play flow keeps going.
trap 'print_manual_fallback' EXIT

# Best-effort Accessibility probe. If System Events can't be driven, we bail to
# the manual fallback. (There is no reliable read API, so this is heuristic.)
ax_ok=1
if ! osascript -e 'tell application "System Events" to get name of first process' >/dev/null 2>&1; then
  ax_ok=0
fi

if [[ "$ax_ok" -ne 1 ]]; then
  echo "NOTE: Could not drive System Events — Accessibility permission is likely"
  echo "missing. Grant it in System Settings > Privacy & Security > Accessibility"
  echo "for your terminal / the app running Claude Code, then try /play again."
  echo "Opening the link manually on your iPhone will still earn the reward."
  exit 0
fi

# Copy the URL to the Mac clipboard FIRST. Universal Clipboard (Handoff) then
# syncs it to the iPhone, so we can paste it whole into mirrored Safari instead
# of typing it character-by-character — typing a ~95-char URL drops characters
# and corrupts the click id / partner_user_id, which breaks reward attribution.
SAVED_CLIPBOARD="$(pbpaste 2>/dev/null || true)"
printf '%s' "$URL" | pbcopy 2>/dev/null || true

# Launch iPhone Mirroring if it is not already running; give it time to connect.
if ! pgrep -x "iPhone Mirroring" >/dev/null 2>&1; then
  echo "Launching iPhone Mirroring..."
  open -b com.apple.ScreenContinuity || true
  /bin/sleep 5
else
  echo "iPhone Mirroring already running."
fi

# Drive the phone via simulated hardware-keyboard input through the mirror.
# Key codes: Cmd+1=Home(18), Cmd+3=Spotlight(20), Return=36.
# The fragile part — the long URL — is PASTED (Cmd+V) via Universal Clipboard,
# not typed. Short literals (the word "Safari") are still safe to keystroke.
osascript <<APPLESCRIPT || true
tell application "iPhone Mirroring" to activate
delay 1.5

tell application "System Events"
  tell process "iPhone Mirroring"
    set frontmost to true
  end tell

  -- Go Home for a clean starting state (Cmd+1).
  key code 18 using {command down}
  delay 1

  -- Open iPhone Spotlight (Cmd+3).
  key code 20 using {command down}
  delay 1.2

  -- Search for Safari and open it.
  keystroke "Safari"
  delay 0.6
  key code 36 -- Return
  delay 3

  -- Focus Safari's address bar (Cmd+L), select all, and PASTE the URL whole.
  -- The extra delay gives Universal Clipboard time to propagate to the phone.
  keystroke "l" using {command down}
  delay 1.2
  keystroke "a" using {command down}
  delay 0.3
  keystroke "v" using {command down}
  delay 0.8
  key code 36 -- Return
end tell
APPLESCRIPT

# Restore whatever was on the Mac clipboard before we hijacked it.
if [[ -n "${SAVED_CLIPBOARD}" ]]; then
  printf '%s' "$SAVED_CLIPBOARD" | pbcopy 2>/dev/null || true
fi

echo "Attempted to open the link on your iPhone via iPhone Mirroring."
echo "Watch the mirrored screen — Safari should be loading the App Store page."
# trap prints the manual fallback on exit.
exit 0
