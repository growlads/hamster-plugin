---
name: Wallet
description: Show the user's hamster wallet — current balance, lifetime earned, and recent rewards from games they played. Use when the user asks how much they have made, their balance, earnings, rewards, payouts, wallet, or hamster stats.
allowed-tools: Bash
---

# /wallet — your hamster earnings

Fetch and summarize the user's earnings from the Hamster backend.

## Steps

1. **Fetch the wallet.** Run `bash ${CLAUDE_SKILL_DIR}/scripts/wallet.sh`.
   - On exit 2 (not configured) or exit 1 (backend error), relay the printed
     message and STOP.
   - On success it prints JSON like:
     `{"balance_usd": 12.5, "lifetime_usd": 14.0, "reversed_usd": 1.5,
       "sessions_count": 3, "recent": [{"date","game","note","amount_usd","reversed"}]}`

2. **Render a short summary.** Present:
   - **Balance** (`balance_usd`) and **lifetime earned** (`lifetime_usd`), as USD.
   - Sessions played (`sessions_count`) and total reversed (`reversed_usd`) if > 0.
   - A small table of `recent` rewards: date, game, note, amount.
     Mark any entry with `reversed: true` as a clawback (e.g. strike-through or a
     "(reversed)" tag) and do not count it toward the positive total.

Keep it tight and friendly — a couple of headline numbers plus the recent table.
