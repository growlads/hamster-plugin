// welcome-card.js — the "hamster · play is live" greeting.
//
// Single source of truth so the Claude Code SessionStart hook (welcome.js) and
// the Codex launch banner (scripts/codex-banner) render the SAME greeting — the
// only per-surface difference is the agent named in the value line (the `agent`
// option). Pure: no I/O, no side effects, safe to require from anywhere.
//
// EDIT COPY HERE ONLY. Claude's welcome.js calls buildWelcome() live each
// session, but the Codex banner SNAPSHOTS it into ~/.hamster/codex-banner.txt at
// install time — so after changing this copy you must re-run
//   node scripts/codex-banner/install.js install
// to refresh an already-installed Codex banner (a plugin re-snapshot won't, since
// the banner lives outside the plugin system). See plugins/hamster/AGENTS.md.
"use strict";

// Brand palette (landing.ts) + a cash-green "live" status. Honored only when
// color is on; NO_COLOR (or a non-truecolor host) prints plain text.
const NO_COLOR = !!process.env.NO_COLOR;
const E = (s) => "\x1b[" + s + "m", R = "\x1b[0m";
const sty = (codes) => (s) => (NO_COLOR ? s : E(codes) + s + R);
const goldB = sty("1;38;2;255;182;39");
const cream = sty("38;2;240;234;222");
const creamB = sty("1;38;2;245;240;232");
const dim = sty("38;2;146;136;122");
const faint = sty("38;2;112;104;92");                       // frame
const greenChip = sty("1;48;2;46;204;113;38;2;20;40;26");   // green bg, dark text — "LIVE"
const pausedChip = sty("1;48;2;90;84;74;38;2;232;226;216");  // muted gray bg, light text — "PAUSED"

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vw = (s) => String(s).replace(ANSI_RE, "").length; // visible width (ignores ANSI)

/** Rounded, ANSI-aware framed card: each line padded to a common visible width,
 *  faint border, 1-col/1-row padding. (Used by buildWelcome.) */
function box(lines, opts) {
  opts = opts || {};
  const round = opts.round !== false, vpad = opts.vpad == null ? 1 : opts.vpad, hpad = opts.hpad == null ? 1 : opts.hpad;
  const W = Math.max.apply(null, lines.map(vw));
  const innerW = W + hpad * 2;
  const c = round ? { tl: "╭", tr: "╮", bl: "╰", br: "╯" } : { tl: "┌", tr: "┐", bl: "└", br: "┘" };
  const H = "─", V = faint("│");
  const blank = V + " ".repeat(innerW) + V;
  const rows = [faint(c.tl + H.repeat(innerW) + c.tr)];
  for (let k = 0; k < vpad; k++) rows.push(blank);
  for (const l of lines) rows.push(V + " ".repeat(hpad) + l + " ".repeat(Math.max(0, W - vw(l)) + hpad) + V);
  for (let k = 0; k < vpad; k++) rows.push(blank);
  rows.push(faint(c.bl + H.repeat(innerW) + c.br));
  return rows.join("\n");
}

/** The greeting: a minimal rounded card — a status chip + brand on the top line
 *  and ONE concise main line. No QR (that rides on the first prompt).
 *
 *  ACTIVE  (default): a green "● LIVE" chip + the value line.
 *  PAUSED  (paused:true): a muted "⏸ PAUSED" chip + how to resume. Pass paused
 *  from the launcher's HAMSTER_PAUSED state (see welcome.js).
 *
 *  agent (default "Claude"): the coding agent named in the value line. The Claude
 *  Code SessionStart hook (welcome.js) leaves the default; the Codex launch banner
 *  (codex-banner/install.js) passes "Codex" so the line reads true on each surface. */
function buildWelcome(opts) {
  const paused = !!(opts && opts.paused);
  const agent = (opts && opts.agent) || "Claude";
  if (paused) {
    return box([
      pausedChip(" ⏸ PAUSED ") + "  " + goldB("hamster") + dim(" · play"),
      "",
      dim("QR paused — run ") + cream("toggle-hamster") + dim(" to start earning again."),
    ], { round: true });
  }
  return box([
    greenChip("● LIVE ") + "  " + goldB("hamster") + dim(" · play"),
    "",
    creamB("Play while you wait, earn while " + agent + " codes."),
  ], { round: true });
}

module.exports = { box, buildWelcome };
