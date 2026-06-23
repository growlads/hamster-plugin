#!/usr/bin/env node
/*
 * nudge.js — QR nudge hook brain.
 *
 * On every prompt (UserPromptSubmit), show a small QR for the featured game so
 * the user can start playing/earning while the agent works. The featured game is
 * fetched fresh from the backend on every prompt — we deliberately keep NO
 * client-side cache (see `featured`). The backend's own ~2 min offer cache keeps
 * the warm round-trip to ~1.5s.
 *
 * Output contract: the QR rides in `systemMessage`, which is shown to the user
 * without becoming model context. We never set decision:block, and stdout only
 * contains the JSON hook response. (For UserPromptSubmit, plain stdout would be
 * fed to the model as context — so we emit ONLY the JSON response, never the QR.)
 *
 * Layout note: systemMessage renders into a possibly-narrow prompt-notice area.
 * We default to a side-by-side card (QR left, short copy right). The copy is
 * brief authored marketing — NOT the game's long store description — so the card
 * stays compact and balanced. If we can detect that the panel is too narrow to
 * fit the card, we fall back to a vertical stack (headline, QR, copy) so the
 * copy column never collapses into a squeezed ribbon.
 *
 * Reads the hook JSON (with session_id) from stdin. Stays silent on any problem
 * — a nudge must never disrupt session startup.
 */
"use strict";

const path = require("path");
// const fs = require("fs"); // only used by the client-side cache (disabled below)
// const os = require("os"); // only used by the client-side cache (disabled below)
const { renderQrForTerminal, displayWidth } = require(path.join(__dirname, "qr-block.js"));
const { isWalletCommand } = require(path.join(__dirname, "..", "wallet", "wallet-card.js"));
const { isToggleCommand } = require(path.join(__dirname, "..", "toggle-pause.js"));
const { logEvent } = require(path.join(__dirname, "..", "hook-debug.js"));

// Prefer IPv4 for the backend call. Node's fetch (undici) otherwise tries IPv6
// first and, on hosts without working IPv6, stalls ~5s on Happy-Eyeballs before
// falling back — which alone could blow the fetch timeout below and leave the
// nudge blank. Best-effort; ignore if the runtime predates this API.
try { require("dns").setDefaultResultOrder("ipv4first"); } catch { /* node < 16.4 */ }

function done(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(data); } };
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 1500); // never hang the prompt
  });
}

// fetch with a hard timeout. The cap has to clear a *cold* round trip: a fresh
// Node process per hook (no connection reuse) over HTTPS to a possibly-cold
// Cloudflare worker that itself makes a cold Besitos call. Measured ~5–6s cold
// vs ~1.5s once the server-side cache (~2 min) is warm. 5s was too tight against
// the production backend and the nudge silently never showed; 9s clears it while
// still bounding how long the first prompt of a session can wait.
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

// ── Client-side cache: DISABLED by product decision (we don't want stale offers
// riding the QR). Kept here, commented, so it can be restored quickly: uncomment
// this block, the cached path in featured() below, and the fs/os requires above.
//
// Local cache so the QR can ride EVERY prompt without a backend round-trip each
// time. TTL mirrors the backend's ~2 min offer cache: within it we re-show the
// same game (and the same /go link — fine, since the offer is resolved at scan
// time, not when the QR is drawn). The cache is global (not per-session); a
// single user token means concurrent sessions share the same featured game.
// const FEATURED_TTL_MS = 120000;
// const cachePath = () => path.join(os.tmpdir(), "hamster-nudge", "featured.json");
//
// function readCache() {
//   try {
//     const { ts, game } = JSON.parse(fs.readFileSync(cachePath(), "utf8"));
//     if (game && game.url) return { ts: Number(ts) || 0, game };
//   } catch { /* missing/corrupt → no cache */ }
//   return null;
// }
//
// function writeCache(game) {
//   try {
//     fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
//     fs.writeFileSync(cachePath(), JSON.stringify({ ts: Date.now(), game }));
//   } catch { /* best effort */ }
// }

async function fetchFeatured(ms) {
  const api = (process.env.HAMSTER_API_URL || "http://localhost:8787").replace(/\/+$/, "");
  const token = process.env.HAMSTER_TOKEN || "";
  if (!token) return null;
  try {
    const r = await fetchWithTimeout(api + "/v1/featured", { headers: { Authorization: "Bearer " + token } }, ms);
    if (!r.ok) return null;
    const g = (await r.json()).game || {};
    const url = g.go_url || g.click_url;
    if (!url) return null;
    const reward = typeof g.reward_usd_total === "number" ? g.reward_usd_total.toFixed(2) : null;
    // We intentionally ignore the game's own store description here — the nudge
    // copy is short, authored marketing (see buildNudge), not the long blurb.
    return { title: g.title || "a rewarded game", url, reward };
  } catch {
    return null;
  }
}

/**
 * The featured game. The client-side cache is DISABLED — we fetch fresh from the
 * backend on every prompt (no stale offers), bounded at 9s; the backend's own
 * ~2 min offer cache keeps the warm case to ~1.5s. The cached path is kept
 * commented so it can be restored. Always fails soft to null (→ silent nudge).
 */
async function featured() {
  // const cached = readCache();
  // if (cached && Date.now() - cached.ts < FEATURED_TTL_MS) return cached.game;
  //
  // const fresh = await fetchFeatured(cached ? 3000 : 9000);
  // if (fresh) { writeCache(fresh); return fresh; }
  // return cached ? cached.game : null;
  return fetchFeatured(9000);
}

/**
 * Unseen earnings since the last nudge summary. The backend claims-and-marks-read
 * in this one call (advancing a per-user cursor), so each reward is celebrated
 * exactly once — no client-side "read" bookkeeping. Returns the positive delta
 * `{ count, total }` or null when there's nothing new. It never calls Besitos
 * (pure ledger read), so it's quick; a tighter timeout than featured keeps it
 * from ever extending the worst case when run in parallel. Always fails soft.
 */
async function fetchEarnings(ms) {
  const api = (process.env.HAMSTER_API_URL || "http://localhost:8787").replace(/\/+$/, "");
  const token = process.env.HAMSTER_TOKEN || "";
  if (!token) return null;
  try {
    const r = await fetchWithTimeout(api + "/v1/earnings", { headers: { Authorization: "Bearer " + token } }, ms);
    if (!r.ok) return null;
    const e = (await r.json()) || {};
    const count = Number(e.count) || 0;
    const total = Number(e.total_usd) || 0;
    if (count <= 0 || total <= 0) return null;
    return { count, total: total.toFixed(2) };
  } catch {
    return null;
  }
}

/** Unseen earnings, bounded at 6s — shorter than featured's 9s, so when both run
 *  in parallel the earnings read can never be the long pole. Fails soft to null. */
async function earned() {
  return fetchEarnings(6000);
}

// Pause flag (set by launch.js from env > ~/.hamster/config). Treat "1"/"true"
// (case-insensitive) as paused; anything else as active.
function isPaused(env = process.env) {
  const v = String(env.HAMSTER_PAUSED || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

async function run() {
  // Drain stdin (the hook pipes its JSON in). We no longer gate the QR on it —
  // it rides on every prompt — EXCEPT the wallet/toggle commands: there the
  // wallet/toggle hooks own the output, so we stay silent rather than draw a QR
  // beside their card (on Codex every UserPromptSubmit hook fires on the prompt).
  const raw = await readStdin();
  let hook = {};
  try { hook = JSON.parse(raw) || {}; } catch { /* not JSON */ }
  logEvent("nudge", hook);
  const prompt = hook.prompt || "";
  if (isWalletCommand(prompt) || isToggleCommand(prompt)) done(null);

  // Paused → emit nothing, and skip the backend fetch entirely (no point paying
  // a network round-trip when we won't draw the card). Toggled with
  // /hamster:toggle-hamster; takes effect next prompt since config is read fresh.
  if (isPaused()) done(null);

  // Featured game + any unseen earnings, fetched in PARALLEL: the earnings read
  // overlaps the (much slower) offer fetch, so the summary costs ~no extra wall
  // clock. Either may fail independently without sinking the other.
  const [game, earnings] = await Promise.all([featured(), earned()]);

  // Lead with the good news (you got paid), then the QR to keep playing. Each
  // part is optional: just earnings, just the card, both, or — if neither is
  // available (not configured / unreachable) — stay silent.
  const parts = [];
  if (earnings) parts.push(buildEarnings(earnings));
  if (game) parts.push(buildNudge(game));
  if (parts.length === 0) done(null);

  // systemMessage shows to the user; no decision:block, so the prompt proceeds.
  // Lead with a newline so the nudge starts on its own line under the notice.
  done({ systemMessage: "\n" + parts.join("\n\n") });
}

// Auto-run when launched as the QR brain (launch.js require()s this module, and
// the hook also runs it directly). Tests set HAMSTER_NO_AUTORUN to import the
// pure helpers (isPaused, buildNudge) without firing the stdin/network flow.
if (!process.env.HAMSTER_NO_AUTORUN) run();

module.exports = { isPaused, buildNudge, buildEarnings, copyLines };

/** Greedy word-wrap to `width` columns. */
function wrap(text, width) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= width) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Best-effort display width. The hook's stdout is a pipe, so these are usually
// unset — when unknown we return 0 and let the caller default to the (compact)
// side-by-side card rather than guess a narrow panel.
function termWidth(columns) {
  const c = columns || process.stdout.columns || process.stderr.columns || Number(process.env.COLUMNS) || 0;
  return Number.isFinite(c) && c > 0 ? c : 0;
}

// ── styling: terminal-PALETTE colors (not 24-bit truecolor) so the nudge adapts
// to BOTH light and dark themes. Hard-coded RGB ignores the terminal theme — the
// old warm-cream body (near-white) and warm-gray dim washed out on light
// backgrounds. Instead we reference the terminal's own palette, which each theme
// remaps to shades readable against its background:
//   • body / game name → the DEFAULT foreground (no color / bold) — always
//     contrasts with whatever background is actually behind it.
//   • muted lines      → the ANSI faint attribute: a quiet shade of the default
//     fg on any bg; where unsupported it degrades to normal — still readable.
//   • accents          → the 16 ANSI slots — yellow for the brand gold, green for
//     the cash line. The theme picks a gold/green that reads on its own bg (on
//     dark a bright one, on light a deeper one). We use the STANDARD (not
//     "bright") slots because bright yellow/green wash out on a light background.
const NO_COLOR = !!process.env.NO_COLOR;
const E = (s) => "\x1b[" + s + "m", RZ = "\x1b[0m";
const sty = (codes) => (s) => (NO_COLOR || !codes ? s : E(codes) + s + RZ);
const goldB = sty("1;33"); // bold yellow — frame title, /wallet callout, ✦
const gold = sty("33");    // yellow — frame border, CTA arrow, " · play"
const cream = sty("");     // default foreground — body copy
const creamB = sty("1");   // bold default fg — game name
const dim = sty("2");      // faint default fg — kicker, pitch, secondary lines
const cashB = sty("1;32"); // bold green — reward / earnings amount

const vw = displayWidth; // visible width (ignores ANSI)
const pad = (s, w) => s + " ".repeat(Math.max(0, w - vw(s)));

const RW = 26; // right-column copy width
const PITCH = "Install and play the game on your phone for cash rewards, while the agent codes";

/** Styled copy beside the QR. Brand lives in the frame title (not repeated here).
 *  The reward amount rides as a high-contrast cash line when the backend gave us
 *  one; it's omitted gracefully when game.reward is null/absent. */
function copyLines(game) {
  return [
    dim("EARN WHILE YOU CODE"),
    "",
    creamB(game.title),
    ...(game.reward ? [cashB("Earn up to $" + game.reward)] : []),
    "",
    ...wrap(PITCH, RW).map(dim),
    "",
    gold("▸ ") + cream("Scan to start"),
    "",
    // Point at the wallet skill as the action to check credits, shown as the
    // short /wallet form (per product call). The skill is registered as
    // /hamster:wallet and also auto-triggers on the word "wallet".
    dim("Credits land ~15 min later."),
    cream("Run ") + goldB("/wallet") + cream(" to check them."),
  ];
}

/**
 * The earnings topper: a tasteful one-time "you got paid" line that rides above
 * the QR card on the next nudge after rewards land. Only ever shown when the
 * backend reports unseen credits (which it then marks read), so it never repeats
 * and never appears empty. `e` is `{ count, total }` with total pre-formatted to
 * cents. Kept to two slim lines — a flush-left headline, not a second framed box
 * competing with the gold card beneath it.
 */
function buildEarnings(e) {
  const rewards = e.count === 1 ? "1 reward" : e.count + " rewards";
  const head = goldB("✦ ") + cashB("+$" + e.total) + cream(" earned while you coded");
  const sub =
    dim(rewards + " cleared — ") + cream("run ") + goldB("/wallet") + cream(" to see the breakdown");
  return head + "\n" + sub;
}

/** Two-column body: QR left, copy vertically centered on the right. */
function twoCol(qr, copy) {
  const qrW = Math.max(...qr.map(vw)), copyW = Math.max(RW, ...copy.map(vw));
  const rows = Math.max(qr.length, copy.length), top = Math.floor((rows - copy.length) / 2);
  const gap = "   ", out = [];
  for (let i = 0; i < rows; i++) {
    const left = i < qr.length ? pad(qr[i], qrW) : " ".repeat(qrW);
    const ri = i - top, rt = ri >= 0 && ri < copy.length ? copy[ri] : "";
    out.push(left + gap + pad(rt, copyW));
  }
  return out;
}

/** Gold-framed rounded card with the brand in the top edge. */
function card(qr, copy) {
  const lines = twoCol(qr, copy);
  const W = Math.max(...lines.map(vw));
  const innerW = W + 2; // 1-col padding each side
  const V = gold("│");
  const title = goldB("hamster") + gold(" · play");
  const right = innerW - vw(title) - 3;
  const top = gold("╭─") + " " + title + " " + gold("─".repeat(Math.max(0, right)) + "╮");
  const blank = V + " ".repeat(innerW) + V;
  const out = [top, blank];
  for (const l of lines) out.push(V + " " + pad(l, W) + " " + V);
  out.push(blank, gold("╰" + "─".repeat(innerW) + "╯"));
  return out.join("\n");
}

/** Narrow fallback: brand headline, QR, then copy — stacked so nothing is squeezed. */
function stacked(qr, copy) {
  const p = "  ";
  const out = [p + goldB("hamster") + dim(" · play") + cream("  —  earn while you code"), ""];
  for (const l of qr) out.push(p + l);
  out.push("");
  for (const l of copy) out.push(p + l);
  return out.join("\n");
}

/**
 * Compose the nudge. Default to the framed side-by-side card; only when we can
 * positively detect that the panel is too narrow do we fall back to the stack.
 */
function buildNudge(game, opts = {}) {
  // Pick the QR renderer by what the terminal can actually paint:
  //   coin    → truecolor terminals get the gold minted coin
  //   full    → 256-color terminals get full background cells, reliable in Terminal.app
  //   reverse → NO_COLOR gets an attribute-only QR
  const rendered = renderQrForTerminal(game.url, { env: opts.env || process.env });
  const qr = rendered.qr.split("\n");
  const copy = copyLines(game);

  // Full-size QR (Apple_Terminal et al.) is the byte-heavy case: even as plain
  // B/W it's a tall block, and wrapping it in the framed card adds a truecolor
  // `│` escape on BOTH edges of every row (~1.4KB) plus alignment padding —
  // enough to push the systemMessage past the host's ~10KB inline-render cap (it
  // then collapses to a "preview + saved to file"). The stacked layout has no
  // frame and no per-row padding, so it keeps the big QR comfortably under the
  // cap. The default coin is small enough to keep the nicer framed card.
  if (rendered.mode === "coin-full") return stacked(qr, copy);

  const qrW = Math.max(...qr.map(vw));
  const copyW = Math.max(RW, ...copy.map(vw));
  const cardW = qrW + 3 + copyW + 4; // gap + borders + side padding
  const avail = termWidth(opts.columns);

  return avail && cardW > avail ? stacked(qr, copy) : card(qr, copy);
}
