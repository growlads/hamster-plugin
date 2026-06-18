---
name: toggle-hamster
description: Pause or resume the Hamster per-prompt QR card. Slash-only — run when the user explicitly wants to stop or restart the QR nudges.
disable-model-invocation: true
allowed-tools: Bash
---

# /toggle-hamster — pause or resume the QR

Flip the Hamster pause flag. When paused, no QR card rides on your prompts; when
active, the per-prompt QR comes back. It's a single toggle — running it again
flips the state back.

## Steps

1. **Run the toggle.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/toggle-pause.js"`.
   - It flips the saved `HAMSTER_PAUSED` flag in `~/.hamster/config` and prints a
     one-line confirmation (either "hamster paused …" or "hamster live …").

2. **Relay the confirmation.** Show the user the exact line the script printed —
   that's the status. The change takes effect on the next prompt (the QR is read
   fresh each prompt).

Then return to whatever you were working on.
