// qr-block.js — QR renderer for the start-of-session nudge (nudge.js). Turns a
// URL into a block of Unicode half-block characters. No native deps (vendored
// MIT qrcode-generator). Also used by the disabled /qr command (see
// ../../disabled/scripts/qr/render-qr.js) if that surface is ever re-enabled.
"use strict";

const path = require("path");
// Vendored encoder. Prefer the plugin layout (./vendor/), but fall back to a
// sibling qrcode-generator.js so a flat COPY of this file (pasted into a test
// dir next to qrcode-generator.js) still resolves it.
const qrcode = (() => {
  for (const p of [path.join(__dirname, "vendor", "qrcode-generator.js"), path.join(__dirname, "qrcode-generator.js")]) {
    try { return require(p); } catch (_) { /* try next layout */ }
  }
  throw new Error("qr-block.js: qrcode-generator.js not found (looked in ./vendor/ and alongside this file)");
})();
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

// Brand gold (hamster-play/src/landing.ts): bright honey for the finder eyes and
// the $, deep honey for the data. Truecolor; only the dark modules are painted,
// so the QR rides on the terminal's own (dark) background — that doubles as the
// quiet zone, which is why margin 0 still scans here.
const HONEY = "255;182;39"; // --honey       (#ffb627)
const DEEP = "240;138;36";  // --honey-deep  (#f08a24)
const GREEN = "46;204;113"; // the $ — a "real cash" green that pops on the gold

// Minted-coin palette (renderQrCoin). The coin paints its OWN deep background, so
// — unlike the flush half-block QR, which borrows the terminal's dark bg as its
// quiet zone and therefore washes out / won't scan on a LIGHT terminal — it stays
// scannable on any terminal. Gold modules on the deep face read as an inverted QR;
// a struck "rim" line + a ring of reeding ticks frame it like a coin. RGB triples
// (not "r;g;b" strings) because the coin sets an explicit background per cell.
const COIN_FACE = [22, 15, 9];      // deep warm near-black — the coin body
const COIN_RIM = [255, 198, 88];    // bright struck gold — rim line + reeding ticks
const COIN_FINDER = [255, 182, 39]; // = HONEY, as RGB — the finder eyes
const COIN_DATA = [240, 138, 36];   // = DEEP, as RGB — the data modules

// Nearest xterm-256 index for an [r,g,b] — lets the coin render in 256-color on
// terminals that mangle 24-bit truecolor (macOS Terminal.app). Maps onto the
// 6×6×6 color cube, or the grayscale ramp for near-neutral colors.
function rgb256([r, g, b]) {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) {       // near-gray → grayscale ramp
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const lvls = [0, 95, 135, 175, 215, 255];
  const idx = (v) => { let best = 0, bd = Infinity; for (let i = 0; i < 6; i++) { const d = Math.abs(lvls[i] - v); if (d < bd) { bd = d; best = i; } } return best; };
  return 16 + 36 * idx(r) + 6 * idx(g) + idx(b);
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Visible width of a string, ignoring ANSI color escapes (for layout math). */
function displayWidth(s) {
  return String(s).replace(ANSI_RE, "").length;
}

/**
 * Render `text` as a QR using Unicode half-blocks (two QR rows per text line, so
 * modules stay square and scannable). Defaults are tuned small: error-correction
 * level L and a 1-module quiet zone keep the code as compact as the data allows.
 * The encoded URL length is the real floor on size — a short domain shrinks it
 * far more than any render tweak.
 *
 * Options:
 *   color   — paint the dark modules in brand gold (ANSI truecolor).
 *   twoTone — color the three finder eyes bright honey, the data deep honey.
 *   badge   — knock out a 3×3 center and stamp a $ (decodes fine: ECC L recovers
 *             the few lost modules — verified by jsQR). Works with or without color.
 *   badgeColor — "r;g;b" for the $ (defaults to a cash-green that pops on the gold).
 * With color/badge off the output is byte-for-byte the plain half-block QR.
 */
function renderQrBlock(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const margin = opts.margin == null ? 1 : opts.margin;
  const color = !!opts.color;
  const twoTone = !!opts.twoTone;
  const badge = !!opts.badge;
  const badgeColor = opts.badgeColor || GREEN;

  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  const dark = (r, c) => {
    const rr = r - margin, cc = c - margin;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) return false;
    return qr.isDark(rr, cc);
  };
  // Is the module at render-coords (r,c) part of one of the three finder eyes?
  const isFinder = (r, c) => {
    const rr = r - margin, cc = c - margin;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) return false;
    const inF = (r0, c0) => rr >= r0 && rr < r0 + 7 && cc >= c0 && cc < c0 + 7;
    return inF(0, 0) || inF(0, n - 7) || inF(n - 7, 0);
  };

  const nLines = Math.ceil(size / 2);
  // Center badge: a 3×3-cell knockout with the $ on its middle line.
  const bx = Math.floor(size / 2) - 1, by = Math.floor(nLines / 2) - 1;
  const midY = by + 1, gx = bx + 1;
  const inBox = (ly, c) => badge && ly >= by && ly < by + 3 && c >= bx && c < bx + 3;
  // Color the dark modules, RUN-LENGTH ENCODED: open a color escape only when the
  // run's color changes and close it with a single reset when the run ends, instead
  // of wrapping every cell in its own escape+reset. The *visible* output (glyphs +
  // colors) is byte-for-byte identical — we just stop repeating the ~18-byte
  // truecolor sequence for every module in a same-color run. On a 33-module QR that
  // is the difference between ~8 KB and ~2 KB of escapes (this rides every prompt).
  // With color off, output is the plain half-block QR (no escapes at all).
  const SGR = (code) => "\x1b[" + code + "m";
  const RESET = "\x1b[0m";
  const codeData = "38;2;" + DEEP;
  const codeFinder = "38;2;" + HONEY;
  const codeBadge = "1;38;2;" + badgeColor;

  const lines = [];
  for (let ly = 0; ly < nLines; ly++) {
    let line = "";
    let open = null; // SGR code currently applied on this line, or null when none
    // `null` = transparent cell (a blank/space): keep whatever color is open and
    // just print it — foreground color on a space is invisible, so a same-color run
    // separated by gaps stays a single escaped run instead of reset/reopening around
    // every blank. Color is only switched for a different color, and reset at EOL.
    const put = (ch, code) => {
      if (code !== null && code !== open) {
        if (open !== null) line += RESET;
        line += SGR(code);
        open = code;
      }
      line += ch;
    };
    for (let c = 0; c < size; c++) {
      if (badge && ly === midY && c === gx) { put("$", color ? codeBadge : null); continue; }
      if (inBox(ly, c)) { put(" ", null); continue; }
      const r = ly * 2;
      const top = dark(r, c);
      const bottom = r + 1 < size ? dark(r + 1, c) : false;
      const ch = top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      if (ch === " " || !color) { put(ch, null); continue; }
      const isF = twoTone && ((top && isFinder(r, c)) || (bottom && isFinder(r + 1, c)));
      put(ch, isF ? codeFinder : codeData);
    }
    if (open !== null) line += RESET; // never leak color past the line
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Render `text` as a "minted coin": a SELF-CONTAINED QR that paints its own deep
 * background, a struck-gold rim, and a ring of evenly-spaced reeding ticks. Where
 * renderQrBlock paints only the dark modules and rides the terminal's own dark
 * background as the quiet zone (so it vanishes / won't scan on a light terminal),
 * the coin carries everything it needs to scan on ANY terminal.
 *
 * Built from ▀ half-blocks: the top half is the foreground, the bottom half the
 * background, so each glyph stacks two module rows; a transparent half drops to
 * the terminal bg (▄ flips which half shows). Per-cell colors are run-length
 * encoded to keep the escape volume down — this rides every prompt.
 *
 * SAME coin design, two render settings (so we never ship a second QR):
 *   depth — "truecolor" (default, 24-bit `38;2`) or "256" (`38;5`). 256 is for
 *           terminals that MANGLE truecolor (Apple_Terminal) but render 256 fine.
 *   cell  — "half" (default): ▀ half-blocks, two module rows per line, compact.
 *           "full": one module per line as solid background cells (cellWidth
 *           spaces, no glyph). Bigger, but it removes the half-block glyph
 *           geometry that macOS Terminal.app distorts — so it scans there.
 *
 * Other options:
 *   quiet  — dark modules between the code and the rim (the scan quiet zone).
 *   margin — cells of reeding / breathing room outside the coin.
 *   cellWidth — columns per module in "full" mode (default 2, keeps modules square).
 *   colors — { finder, data, rim, face } as RGB triples ([r,g,b]).
 * Returns a newline-joined string (same contract as renderQrBlock). For NO_COLOR,
 * the caller should fall back to renderQrReverse (the coin needs color).
 */
function renderQrCoin(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const quiet = opts.quiet == null ? 3 : opts.quiet;
  const margin = opts.margin == null ? 2 : opts.margin;
  const depth = opts.depth === "256" ? "256" : "truecolor";
  const full = opts.cell === "full";
  const cellWidth = opts.cellWidth == null ? 2 : Math.max(1, opts.cellWidth);
  const colors = opts.colors || {};
  const finder = colors.finder || COIN_FINDER;
  const data = colors.data || COIN_DATA;
  const rim = colors.rim || COIN_RIM;
  const face = colors.face || COIN_FACE;

  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isDark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const isFinder = (r, c) => {
    const f = (r0, c0) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    return f(0, 0) || f(0, n - 7) || f(n - 7, 0);
  };
  // distance of a module coord OUTSIDE the n×n code box (0 while inside it)
  const geom = (r, c) => {
    const dr = r < 0 ? -r : r >= n ? r - (n - 1) : 0;
    const dc = c < 0 ? -c : c >= n ? c - (n - 1) : 0;
    return { dr, dc, cheb: Math.max(dr, dc), euc: Math.hypot(dr, dc) };
  };
  const inCoin = (g) => g.euc <= quiet + 0.5;        // a round face → rounded corners
  const onRim = (g) => inCoin(g) && g.euc >= quiet - 0.4;

  // The color of any module coord, or null = transparent (show the terminal bg).
  const sample = (r, c) => {
    if (isDark(r, c)) return isFinder(r, c) ? finder : data;
    const g = geom(r, c);
    if (g.cheb === 0) return face;                    // a light module, on the face
    if (inCoin(g)) return onRim(g) ? rim : face;
    if (g.cheb - quiet === 1) {                       // reeding: the first ring out
      const along = g.dr >= g.dc ? c : r;             // run ticks along the edge…
      const corner = g.dr > quiet && g.dc > quiet;    // …but skip the four corners
      if (!corner && (((along % 2) + 2) % 2) === 0) return rim;
    }
    return null;
  };

  const SGR = (a) => "\x1b[" + a + "m";
  const RESET = "\x1b[0m";
  // 39/49 = default fg/bg (transparent → terminal bg). Color code per depth.
  const fgCode = (c) => (!c ? "39" : depth === "256" ? "38;5;" + rgb256(c) : "38;2;" + c.join(";"));
  const bgCode = (c) => (!c ? "49" : depth === "256" ? "48;5;" + rgb256(c) : "48;2;" + c.join(";"));
  const pad = quiet + margin;

  if (full) {
    // One module per line, solid background cells (no half-block glyph). Terminal.app
    // has no glyph geometry to distort and — in 256-color — no truecolor to mangle.
    const block = " ".repeat(cellWidth);
    const lines = [];
    for (let r = -pad; r < n + pad; r++) {
      let line = "", curBg = "x";
      for (let c = -pad; c < n + pad; c++) {
        const bgc = bgCode(sample(r, c));
        if (bgc !== curBg) { line += SGR(bgc); curBg = bgc; }
        line += block;
      }
      lines.push(line + RESET);
    }
    return lines.join("\n");
  }

  // Packed half-block (default): one char stacks two module rows; a null
  // (transparent) half is left unpainted so the terminal bg shows through.
  const cell = (top, bot) =>
    top && bot ? { ch: "▀", fg: top, bg: bot } :
    top ? { ch: "▀", fg: top, bg: null } :
    bot ? { ch: "▄", fg: bot, bg: null } :
    { ch: " ", fg: null, bg: null };
  const lines = [];
  for (let r = -pad; r < n + pad; r += 2) {
    let line = "", curFg = "x", curBg = "x";
    for (let c = -pad; c < n + pad; c++) {
      const { ch, fg, bg } = cell(sample(r, c), sample(r + 1, c));
      const fgc = fgCode(fg), bgc = bgCode(bg);
      const codes = [];
      if (bgc !== curBg) { codes.push(bgc); curBg = bgc; }
      if (fgc !== curFg) { codes.push(fgc); curFg = fgc; }
      if (codes.length) line += SGR(codes.join(";"));
      line += ch;
    }
    lines.push(line + RESET); // never leak color past the line
  }
  return lines.join("\n");
}

/**
 * What color depth can we safely emit? The gold renderers use 24-bit truecolor
 * (`38;2;r;g;b`). Terminals that DON'T support it (notably macOS Terminal.app)
 * don't ignore the sequence — they parse `38;2;…` as separate SGR codes, so the
 * trailing value lands on a real code (gold's `…;39` → default fg, orange's
 * `…;36` → cyan), turning the QR into unscannable low-contrast mush. So we only
 * emit truecolor when we're confident, and fall back to 256-color (which
 * Terminal.app DOES support) or, under NO_COLOR, attribute-only reverse video.
 *
 * Returns "truecolor" | "256" | "none".
 */
function colorSupport(env) {
  env = env || process.env;
  if (env.NO_COLOR) return "none"; // matches nudge.js's existing NO_COLOR gate
  const ct = String(env.COLORTERM || "").toLowerCase();
  if (ct.includes("truecolor") || ct.includes("24bit")) return "truecolor";
  // Terminals that do 24-bit even when COLORTERM is unset.
  if (/iterm|vscode|wezterm|hyper|tabby|ghostty|\brio\b|warpterminal|kitty|alacritty/i
        .test(env.TERM_PROGRAM || "")) return "truecolor";
  if (/kitty|alacritty|truecolor|direct/i.test(env.TERM || "")) return "truecolor";
  return "256"; // Apple_Terminal & friends advertise xterm-256color
}

// Terminals where the packed half-block coin DOESN'T scan, so it needs the
// full-size (one-module-per-line) coin instead. macOS stock Terminal.app is the
// prime case (TERM_PROGRAM=Apple_Terminal): it both distorts half-block glyph
// geometry (a seam through every module pair) AND mangles 24-bit truecolor. We
// render the coin in 256-color everywhere (see renderQrForTerminal), so the
// remaining reason for full-size here is the seam. Add others as confirmed.
function needsFullSize(env) {
  env = env || process.env;
  return /apple_terminal/i.test(env.TERM_PROGRAM || "");
}

/**
 * Which coin rendering to use. The QR is ALWAYS the coin — the only question is
 * how to paint it:
 *   "coin"      — 256-color half-block coin. The DEFAULT, everywhere. (256, not
 *                 24-bit: ~30% fewer escape bytes so the nudge stays under the
 *                 host's inline-render cap, and it can't be mangled by terminals
 *                 that lack truecolor. Looks near-identical and scans the same.)
 *   "coin-full" — same coin, full-size cells, for terminals whose half-blocks
 *                 don't scan (needsFullSize, e.g. Apple_Terminal).
 *   "reverse"   — NO_COLOR: attribute-only fallback (the coin needs color).
 * Override with HAMSTER_QR_RENDER=coin|coin-full|reverse.
 */
function qrRenderMode(env) {
  env = env || process.env;
  const override = String(env.HAMSTER_QR_RENDER || "").trim().toLowerCase();
  if (override === "coin" || override === "coin-full" || override === "reverse") return override;
  if (env.NO_COLOR) return "reverse";
  if (needsFullSize(env)) return "coin-full";
  return "coin";
}

// 256-color anchors for the no-truecolor fallback: forced black-on-white so the
// code carries its own contrast on a light OR dark theme.
const BW_INK = 16;    // near-black
const BW_PAPER = 231; // near-white

/**
 * 256-color black-on-white QR, half-block packed (two module rows per line, so it
 * stays as compact as the coin). EVERY cell paints both a fg (top half) and a bg
 * (bottom half), so no cell is transparent — that's what defeats the macOS
 * Terminal.app line-spacing "seam" (a background fill covers the inter-line gap;
 * a foreground glyph does not). Uses only `38;5;n`/`48;5;n`, which Terminal.app
 * supports. Same newline-joined contract as renderQrBlock/renderQrCoin.
 */
function renderQrBw(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const quiet = opts.quiet == null ? 2 : opts.quiet;
  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isDark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const idx = (r, c) => (isDark(r, c) ? BW_INK : BW_PAPER); // quiet zone reads as paper
  const SGR = (a) => "\x1b[" + a + "m";
  const RESET = "\x1b[0m";
  const lines = [];
  for (let r = -quiet; r < n + quiet; r += 2) {
    let line = "", curFg = "x", curBg = "x";
    for (let c = -quiet; c < n + quiet; c++) {
      // ▀ : fg paints the top module row, bg paints the bottom one. Both always set.
      const fgc = "38;5;" + idx(r, c), bgc = "48;5;" + idx(r + 1, c), codes = [];
      if (bgc !== curBg) { codes.push(bgc); curBg = bgc; }
      if (fgc !== curFg) { codes.push(fgc); curFg = fgc; }
      if (codes.length) line += SGR(codes.join(";"));
      line += "▀";
    }
    lines.push(line + RESET);
  }
  return lines.join("\n");
}

/**
 * Full-size 256-color black-on-white QR. This mirrors the conservative
 * qrterminal-style approach: every QR module is a solid background-colored cell,
 * rendered as two spaces, so Terminal.app has no half-block glyph geometry to
 * distort. It is bigger than renderQrBw, but this is the reliable macOS stock
 * Terminal fallback.
 */
function renderQrFullBw(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const quiet = opts.quiet == null ? 2 : opts.quiet;
  const cellWidth = opts.cellWidth == null ? 2 : Math.max(1, opts.cellWidth);
  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isDark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const idx = (r, c) => (isDark(r, c) ? BW_INK : BW_PAPER);
  const SGR = (a) => "\x1b[" + a + "m";
  const RESET = "\x1b[0m";
  const cell = " ".repeat(cellWidth);
  const lines = [];
  for (let r = -quiet; r < n + quiet; r++) {
    let line = "", curBg = "x";
    for (let c = -quiet; c < n + quiet; c++) {
      const bgc = "48;5;" + idx(r, c);
      if (bgc !== curBg) {
        line += SGR(bgc);
        curBg = bgc;
      }
      line += cell;
    }
    lines.push(line + RESET);
  }
  return lines.join("\n");
}

/**
 * NO_COLOR QR: reverse-video solid blocks, no color codes at all. A reverse-video
 * space is a cell filled with the terminal's own foreground color (its BACKGROUND
 * under reverse), so dark modules are solid blocks of your text color and light
 * modules are the terminal bg — correct polarity on a light theme, inverted (still
 * scannable) on a dark one. Background-fill, so it's seam-proof too. One module
 * per line, two columns per module (kept square); wider/taller than the packed
 * renderers, but NO_COLOR is the rare path.
 */
function renderQrReverse(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const quiet = opts.quiet == null ? 2 : opts.quiet;
  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isDark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const REV = "\x1b[7m", OFF = "\x1b[27m";
  const lines = [];
  for (let r = -quiet; r < n + quiet; r++) {
    let line = "";
    for (let c = -quiet; c < n + quiet; c++) line += isDark(r, c) ? REV + "  " + OFF : "  ";
    lines.push(line);
  }
  return lines.join("\n");
}

function renderQrForTerminal(text, opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const mode = opts.mode || qrRenderMode(env);
  if (mode === "coin-full") {
    const coinOpts = Object.assign({ depth: "256", cell: "full" }, opts.coinFull);
    return { mode, renderer: "renderQrCoin", qr: renderQrCoin(text, coinOpts) };
  }
  if (mode === "reverse") {
    return { mode, renderer: "renderQrReverse", qr: renderQrReverse(text, opts.reverse) };
  }
  const coinOpts = Object.assign({ depth: "256", cell: "half" }, opts.coin);
  return { mode: "coin", renderer: "renderQrCoin", qr: renderQrCoin(text, coinOpts) };
}

// Quadrant glyphs indexed by a 4-bit mask: TL=8, TR=4, BL=2, BR=1.
const QUAD = [
  " ", "▗", "▖", "▄", "▝", "▐", "▞", "▟",
  "▘", "▚", "▌", "▙", "▀", "▜", "▛", "█",
];

/**
 * Render `text` as a QR using quadrant blocks (a 2x2 module grid per character),
 * so it's ~half the width of the half-block version — compact enough to sit
 * beside text in a card. Trade-off: terminal cells are ~2x taller than wide, so
 * modules aren't perfectly square here; it's less forgiving to scan than
 * renderQrBlock. Returns an array of equal-length lines (caller composes layout).
 */
function renderQrCompactLines(text, opts) {
  opts = opts || {};
  const ecc = opts.ecc || "L";
  const margin = opts.margin == null ? 1 : opts.margin;

  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  const dark = (r, c) => {
    const rr = r - margin, cc = c - margin;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) return false;
    return qr.isDark(rr, cc);
  };

  const lines = [];
  for (let r = 0; r < size; r += 2) {
    let line = "";
    for (let c = 0; c < size; c += 2) {
      const mask =
        (dark(r, c) ? 8 : 0) |
        (dark(r, c + 1) ? 4 : 0) |
        (dark(r + 1, c) ? 2 : 0) |
        (dark(r + 1, c + 1) ? 1 : 0);
      line += QUAD[mask];
    }
    lines.push(line);
  }
  return lines;
}

module.exports = {
  renderQrBlock, renderQrCoin, renderQrBw, renderQrFullBw, renderQrReverse,
  renderQrForTerminal, renderQrCompactLines, colorSupport, qrRenderMode, displayWidth,
};
