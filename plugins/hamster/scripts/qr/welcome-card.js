// welcome-card.js — the "hamster · play is live" greeting.
//
// Single source of truth so the Claude Code SessionStart hook (welcome.js) and
// the Codex launch banner (scripts/codex-banner) render the IDENTICAL greeting.
// Pure: no I/O, no side effects, safe to require from anywhere.
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

/** The greeting: a rounded card led by a green "LIVE" badge + brand, the value,
 *  one line on how it works, and the wallet pointer. No QR (that rides on the
 *  first prompt). */
function buildWelcome() {
  return box([
    greenChip(" ● LIVE ") + "  " + goldB("hamster") + dim(" · play"),
    "",
    creamB("Win real cash while I work."),
    dim("Next prompt: a QR to scan, play & earn."),
    "",
    goldB("/hamster:wallet") + cream(" → your earnings"),
  ], { round: true });
}

module.exports = { box, buildWelcome };
