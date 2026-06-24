// wallet-card.js — pure renderer for the hamster wallet card.
//
// The wallet used to be an LLM skill that received JSON and was told (in prose)
// how to format a ledger. That meant a model turn — latency + token cost — for a
// fully deterministic readout. This renders the same numbers directly so a hook
// can print them with no model in the loop (see ../wallet.js for the hook brain).
//
// Pure + self-contained: no I/O, no requires, no env reads at module scope. The
// caller passes { color } so output is deterministic and unit-testable. Mirrors
// the brand palette in welcome-card.js / nudge.js (landing.ts honey + cash green).
"use strict";

// ── brand palette, applied only when color is on ───────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Visible width, ignoring ANSI color escapes (for column/box math). */
const vw = (s) => String(s).replace(ANSI_RE, "").length;

/** A palette bound to a color on/off choice, so the same code path renders both
 *  the colored terminal card and the plain NO_COLOR fallback. */
function palette(color) {
  const E = (s) => "\x1b[" + s + "m", R = "\x1b[0m";
  const sty = (codes) => (s) => (color ? E(codes) + s + R : String(s));
  return {
    goldB: sty("1;38;2;255;182;39"), // bright honey — brand
    cream: sty("38;2;240;234;222"),  // warm off-white — body
    creamB: sty("1;38;2;245;240;232"), // bold warm white — values
    dim: sty("38;2;146;136;122"),    // muted warm gray — labels, secondary
    faint: sty("38;2;112;104;92"),   // frame
    cashB: sty("1;38;2;46;204;113"), // cash green + bold — balance
    chip: sty("1;48;2;255;182;39;38;2;40;30;8"), // honey bg, dark text — brand chip
  };
}

/** Whole credits (no decimals) — credits are integers (round(payout × 10)).
 *  Non-numbers fail soft to "0 credits" so a malformed field never throws. */
function credits(n) {
  const v = Number(n);
  return Math.round(Number.isFinite(v) ? v : 0).toLocaleString("en-US") + " credits";
}

/** Truncate to `w` columns with an ellipsis, so a long game title can't blow out
 *  the table width. */
function clip(s, w) {
  s = String(s == null ? "" : s);
  return s.length <= w ? s : s.slice(0, Math.max(0, w - 1)) + "…";
}

/** Render a ledger date compactly. The backend sends ISO timestamps
 *  ("2026-06-16T06:00:46.921Z"); we only want the calendar day. Anything that
 *  isn't an ISO datetime is passed through untouched. */
function fmtDate(d) {
  const s = String(d == null ? "" : d);
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(s);
  return m ? m[1] : s;
}

/** Rounded, ANSI-aware framed card (same look as welcome-card.js's box, but with a
 *  color-controlled border so the NO_COLOR path is escape-free). 1-col/1-row pad. */
function box(lines, p) {
  const W = Math.max.apply(null, lines.map(vw));
  const innerW = W + 2;
  const V = p.faint("│");
  const blank = V + " ".repeat(innerW) + V;
  const rows = [p.faint("╭" + "─".repeat(innerW) + "╮"), blank];
  for (const l of lines) rows.push(V + " " + l + " ".repeat(Math.max(0, W - vw(l))) + " " + V);
  rows.push(blank, p.faint("╰" + "─".repeat(innerW) + "╯"));
  return rows.join("\n");
}

const GAME_W = 22; // max game-title column width before truncation

/**
 * Render the wallet card from a /v1/stats payload:
 *   { balance_usd, lifetime_usd, reversed_usd, sessions_count,
 *     recent_total, has_more, recent: [{ date, game, note, amount_usd, reversed }] }
 *
 * opts.color  — paint with the brand palette (default true).
 * opts.agent  — coding agent named in the empty-state line (default "Claude").
 * opts.max    — max ledger rows to show (default 8); the rest roll into the footer.
 */
function buildWallet(stats, opts) {
  opts = opts || {};
  const color = opts.color !== false;
  const agent = opts.agent || "Claude";
  const max = opts.max || 8;
  const p = palette(color);
  const s = stats || {};

  const recent = Array.isArray(s.recent) ? s.recent : [];
  const reversedTotal = Number(s.reversed_usd) || 0;
  const sessions = Number(s.sessions_count) || 0;
  const total = Number(s.recent_total) || recent.length;

  const lines = [];

  // Header: brand chip.
  lines.push(p.chip(" 🐹 hamster ") + p.dim(" · wallet"));
  lines.push("");

  // Headline: the two numbers that matter, labels aligned to a common width.
  const LW = "Lifetime earned".length + 1;
  lines.push(p.dim(padEnd("Balance", LW)) + p.cashB(credits(s.balance_usd)));
  lines.push(p.dim(padEnd("Lifetime earned", LW)) + p.creamB(credits(s.lifetime_usd)));

  // Context line: sessions, and reversed total only if anything was clawed back.
  const ctx = [];
  if (sessions > 0) ctx.push(sessions + (sessions === 1 ? " session" : " sessions"));
  if (reversedTotal > 0) ctx.push(credits(reversedTotal) + " reversed");
  if (ctx.length) lines.push(p.dim(ctx.join("  ·  ")));

  lines.push("");

  // Ledger.
  if (recent.length === 0) {
    lines.push(p.cream("No rewards yet — play a game while " + agent + " codes and they'll land here."));
  } else {
    const shown = recent.slice(0, max);
    const dateW = Math.max(4, ...shown.map((r) => vw(fmtDate(r.date))));
    const gameW = Math.max(4, ...shown.map((r) => vw(clip(r.game, GAME_W))));

    lines.push(
      p.dim(padEnd("DATE", dateW)) + "  " + p.dim(padEnd("GAME", gameW)) + "  " + p.dim("AMOUNT"),
    );
    for (const r of shown) {
      const date = padEnd(fmtDate(r.date), dateW);
      const game = padEnd(clip(r.game, GAME_W), gameW);
      if (r.reversed) {
        // A clawback: shown as negative + tagged, dimmed, and NEVER folded into the
        // positive balance/lifetime (the backend already excludes it from those).
        const row = p.dim(date + "  " + game + "  −" + credits(r.amount_usd) + " ↩ reversed");
        lines.push(row);
      } else {
        lines.push(p.cream(date) + "  " + p.cream(game) + "  " + p.creamB(credits(r.amount_usd)));
      }
    }

    // Footer: this card is a one-shot snapshot — older pages live in the skill
    // ("ask to see older"), not an interactive scroll here.
    const older = Math.max(0, total - shown.length);
    if (s.has_more || older > 0) {
      lines.push("");
      lines.push(p.dim("Showing latest " + shown.length + " of " + total + " — ask to see older."));
    }
  }

  lines.push("");
  lines.push(p.dim("💛 Credits land ~15 min after you play, sometimes longer."));

  return box(lines, p);
}

/** Pad `s` to `w` visible columns (ANSI-aware). */
function padEnd(s, w) {
  return s + " ".repeat(Math.max(0, w - vw(s)));
}

/**
 * Is `prompt` an explicit request for the wallet *command* (not natural language)?
 * Matches the whole prompt being one of: /wallet, /hamster:wallet, wallet (any
 * case, surrounding whitespace ok). Deliberately strict: "what's in my wallet"
 * and "wallets" must NOT match, so the LLM skill still owns conversational asks.
 */
function isWalletCommand(prompt) {
  if (prompt == null) return false;
  // Runtimes prefix the slash command differently: Claude sends "/hamster:wallet",
  // Codex sends "$hamster:wallet" (verified via ~/.hamster/hook-debug.log). Accept
  // either prefix (or none), namespaced or bare. Anchored so natural language never
  // matches.
  return /^[/$]?(hamster:)?wallet$/i.test(String(prompt).trim());
}

module.exports = { buildWallet, isWalletCommand, credits, vw };
