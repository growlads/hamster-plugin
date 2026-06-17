// qr-block.js — QR renderer for the start-of-session nudge (nudge.js). Turns a
// URL into a block of Unicode half-block characters. No native deps (vendored
// MIT qrcode-generator). Also used by the disabled /qr command (see
// ../../disabled/scripts/qr/render-qr.js) if that surface is ever re-enabled.
"use strict";

const path = require("path");
const qrcode = require(path.join(__dirname, "vendor", "qrcode-generator.js"));
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

// Brand gold (hamster-play/src/landing.ts): bright honey for the finder eyes and
// the $, deep honey for the data. Truecolor; only the dark modules are painted,
// so the QR rides on the terminal's own (dark) background — that doubles as the
// quiet zone, which is why margin 0 still scans here.
const HONEY = "255;182;39"; // --honey       (#ffb627)
const DEEP = "240;138;36";  // --honey-deep  (#f08a24)
const GREEN = "46;204;113"; // the $ — a "real cash" green that pops on the gold

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
  const paint = (ch, rgb, bold) =>
    color ? "\x1b[" + (bold ? "1;" : "") + "38;2;" + rgb + "m" + ch + "\x1b[0m" : ch;

  const lines = [];
  for (let ly = 0; ly < nLines; ly++) {
    let line = "";
    for (let c = 0; c < size; c++) {
      if (badge && ly === midY && c === gx) { line += paint("$", badgeColor, true); continue; }
      if (inBox(ly, c)) { line += " "; continue; }
      const r = ly * 2;
      const top = dark(r, c);
      const bottom = r + 1 < size ? dark(r + 1, c) : false;
      const ch = top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      if (ch === " " || !color) { line += ch; continue; }
      const rgb = twoTone && ((top && isFinder(r, c)) || (bottom && isFinder(r + 1, c))) ? HONEY : DEEP;
      line += paint(ch, rgb);
    }
    lines.push(line);
  }
  return lines.join("\n");
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

module.exports = { renderQrBlock, renderQrCompactLines, displayWidth };
