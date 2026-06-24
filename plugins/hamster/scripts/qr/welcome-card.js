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

// Terminal-PALETTE colors (not 24-bit truecolor) so the greeting reads on BOTH
// light and dark themes — same approach as the QR nudge (see nudge.js styling
// note). Hard-coded RGB ignored the terminal theme, so the near-white value line
// vanished on light backgrounds. We instead use the default foreground for body
// text and ANSI palette slots the theme remaps to readable shades; the status
// chips keep an explicit background so their dark text reads on either theme.
// Color is decided PER CALL, not at module load: pass `color` to buildWelcome to
// force it on/off, otherwise it follows NO_COLOR. The Codex banner is a static
// snapshot, so it passes `color: true` — otherwise it would freeze plain whenever
// it happens to be generated from a NO_COLOR / non-interactive shell.
const E = (s) => "\x1b[" + s + "m", R = "\x1b[0m";
function palette(useColor) {
  const sty = (codes) => (s) => (!useColor || !codes ? s : E(codes) + s + R);
  return {
    goldB: sty("1;33"),                                 // bold yellow — brand "hamster"
    cream: sty(""),                                     // default foreground — body
    creamB: sty("1"),                                   // bold default fg — value line
    dim: sty("90"),                                     // muted gray (bright-black) — " · play", hints
    faint: sty("90"),                                   // muted gray — frame border
    greenChip: sty("1;48;2;46;204;113;38;2;20;40;26"),  // green bg, dark text — "LIVE"
    pausedChip: sty("1;48;2;90;84;74;38;2;232;226;216"), // muted gray bg, light text — "PAUSED"
  };
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vw = (s) => String(s).replace(ANSI_RE, "").length; // visible width (ignores ANSI)

/** Rounded, ANSI-aware framed card: each line padded to a common visible width,
 *  faint border, 1-col/1-row padding. `faint` styles the border (identity when
 *  color is off). (Used by buildWelcome.) */
function box(lines, opts) {
  opts = opts || {};
  const round = opts.round !== false, vpad = opts.vpad == null ? 1 : opts.vpad, hpad = opts.hpad == null ? 1 : opts.hpad;
  const faint = opts.faint || ((s) => s);
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
 *  color (default: follow NO_COLOR): force ANSI color on/off. The Codex banner
 *  passes true so its snapshot is always the fancy card.
 *  agent (default "Claude"): the coding agent named in the value line. The Claude
 *  Code SessionStart hook (welcome.js) leaves the default; the Codex launch banner
 *  (codex-banner/install.js) passes "Codex" so the line reads true on each surface. */
function buildWelcome(opts) {
  opts = opts || {};
  const useColor = opts.color != null ? !!opts.color : !process.env.NO_COLOR;
  const paused = !!opts.paused;
  const agent = opts.agent || "Claude";
  const p = palette(useColor);
  if (paused) {
    return box([
      p.pausedChip(" ⏸ PAUSED ") + "  " + p.goldB("hamster") + p.dim(" · play"),
      "",
      p.dim("QR paused — run ") + p.cream("toggle-hamster") + p.dim(" to start earning again."),
    ], { round: true, faint: p.faint });
  }
  return box([
    p.greenChip("● LIVE ") + "  " + p.goldB("hamster") + p.dim(" · play"),
    "",
    p.creamB("Play while you wait, earn while " + agent + " codes."),
  ], { round: true, faint: p.faint });
}

module.exports = { box, buildWelcome };
