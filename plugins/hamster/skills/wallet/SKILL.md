---
name: wallet
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
       "sessions_count": 3, "recent_total": 47, "has_more": true,
       "recent": [{"date","game","note","amount_usd","reversed"}]}`
   - `recent` is one PAGE of the ledger (newest first). `recent_total` is the
     full count; `has_more: true` means older entries exist beyond this page.
   - To page into older history, pass `--offset N` (skip N rows), e.g.
     `bash ${CLAUDE_SKILL_DIR}/scripts/wallet.sh --offset 20`.

2. **Render a clean ledger.** Warm, scannable, honey-brand tone. Tight — no
   filler. Format all money as USD with two decimals (e.g. `$12.50`). Structure:

   **a) Headline.** Lead with the two numbers that matter, on their own lines:
   - 🐹 **Balance:** `balance_usd` — what's available now.
   - **Lifetime earned:** `lifetime_usd`.
   - Then a thin context line only for what applies: sessions played
     (`sessions_count`), and **total reversed** (`reversed_usd`) *only if > 0*.

   **b) Ledger table.** A clean, aligned markdown table of `recent` rewards,
   **newest first** (the backend already returns up to 20). Columns:

   | Date | Game | What | Amount |
   |------|------|------|--------|

   - **Date** = `date`, **Game** = `game`, **What** = `note`, **Amount** = `amount_usd`.
   - For any row with `reversed: true`, mark it clearly as a clawback: prefix the
     amount with `−` and tag it, e.g. `~~$1.50~~ (reversed)`. These are NOT part
     of lifetime/balance — never let them inflate the positive totals you show.
   - If `recent` is empty, skip the table and say something encouraging like
     "No rewards yet — play a game while Claude codes and they'll show up here."
   - Showing the most recent ~10–20 rows is fine; this is static text.

   **c) Show-older + offer.** After the table, close with:
   - If `has_more` is true: tell the user there are older entries (you can note
     how many: `recent_total` minus what's shown) and that they can just ask —
     e.g. *"Showing your latest N of `recent_total`. Want to see older entries,
     or anything else? Just say so."*
   - If `has_more` is false: a lighter one-liner offering more help, e.g.
     *"That's your full history — let me know if you want it broken down any other way."*

   **d) Closing note.** ALWAYS end the summary with this friendly expectation-setter,
   on its own line (verbatim is fine):

   > 💛 Credits usually land ~15 min after you play, sometimes longer.

   **e) Point to the fast path.** This skill spent a full agent turn because the
   user asked in their own words. The explicit command is the intended path —
   Hamster serves it instantly, with **no agent turn**. Close with one short,
   friendly line telling the user how to run it directly next time, using the
   command syntax for the agent they're in:
   - **Claude Code:** `/hamster:wallet` (or the bare `/wallet`)
   - **Codex:** `@hamster:wallet`
   - **Other agents:** their own command prefix (a leading `/`, `@`, etc.).

   e.g. *"Tip: next time just type `/hamster:wallet` — it's instant, no need to ask."*

## Paging into older history

When the user asks to "show older", "see more", "next page", etc., re-run the
script with `--offset` set to how many rows you've already shown (e.g. after the
first page of 20, run `… wallet.sh --offset 20`; after 40, `--offset 40`). Render
just the **ledger table** for that page (no need to repeat the headline numbers),
and again offer the next page while `has_more` is true. Keep paging by the page
size you actually received, so offsets line up.
