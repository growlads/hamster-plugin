---
name: Play
description: Launch a rewarded mobile game on the user's mirrored iPhone so they can play and earn money while Claude keeps working. Manual slash command only.
argument-hint: [game name (optional)]
disable-model-invocation: true
allowed-tools: Bash
---

# /play — play games while your agent spins, and get paid

Launch a rewarded game on the user's iPhone (via iPhone Mirroring) and open its
attribution link on the phone so the install is tracked. Then tell the user what
they can earn while you keep working.

All scripts live in `${CLAUDE_SKILL_DIR}/scripts`. Run them with Bash.

## Steps

1. **Preflight.** Run `bash ${CLAUDE_SKILL_DIR}/scripts/preflight.sh`.
   - Exit 2 means not configured — relay the setup instructions it printed
     (register + save token to `~/.hamster/config`) and STOP.
   - Exit 1 means an environment problem (not macOS 15+, no iPhone Mirroring
     app). Relay the error and STOP.
   - Exit 0 means good — continue.

2. **Get a game + session.** Run
   `bash ${CLAUDE_SKILL_DIR}/scripts/next-game.sh "$ARGUMENTS"`.
   - `$ARGUMENTS` is an optional game-name filter; the backend may ignore it.
   - On success this prints JSON with `session_id`, a `go_url`, a `click_url`,
     and a `game` object (`title`, `reward_usd_total`, `description`,
     `goals[]`, etc.).
   - If it fails (no offers, backend down), tell the user plainly and STOP.

3. **Open it on the iPhone.** Prefer the `go_url` from step 2's JSON (our
   monitored, platform-aware redirect; falls back to `click_url` if `go_url`
   is absent) and run
   `bash ${CLAUDE_SKILL_DIR}/scripts/mirror-open.sh "<go_url>"`.
   - This is best-effort and prints a manual fallback link/QR. Never treat its
     output as a hard failure.

4. **Tell the user.** In a short, upbeat message, report:
   - Which game launched (`title`) and a one-line `description`.
   - Total they can earn (`reward_usd_total`) and the per-goal rewards
     (each goal's `text` → `reward_usd`).
   - That the App Store page is now open on their iPhone (or to use the printed
     fallback link if not) — they should install and play while you keep working.
   - That `/stats` (or `/hamster:stats`) shows their earnings.

Then return to whatever task you were working on.
