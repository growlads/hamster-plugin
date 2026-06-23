"use strict";
/*
 * Run: node --test plugins/hamster/scripts/qr/qr-block.test.js
 *
 * The QR is ALWAYS the coin. The only routing question is how to paint it:
 *   coin       — fancy truecolor half-block (the default, everywhere)
 *   coin-full  — same coin in 256-color, full-size cells, for terminals that
 *                mangle truecolor (Apple_Terminal)
 *   reverse    — NO_COLOR attribute-only fallback
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { qrRenderMode, renderQrForTerminal } = require("./qr-block.js");

const URL = "https://hamster.win/go/test";

test("default (no truecolor signal) still selects the fancy coin", () => {
  const env = { TERM: "xterm-256color" }; // e.g. Windows Terminal / plain PowerShell
  assert.equal(qrRenderMode(env), "coin");
  assert.equal(renderQrForTerminal(URL, { env }).renderer, "renderQrCoin");
});

test("truecolor terminals select the minted coin QR", () => {
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app", COLORTERM: "truecolor" };
  assert.equal(qrRenderMode(env), "coin");
  assert.equal(renderQrForTerminal(URL, { env }).renderer, "renderQrCoin");
});

test("Apple Terminal selects the simple full-size B/W QR (scannable + under the render cap)", () => {
  // Full-size terminals get a plain 2-color QR, not the fancy coin: the coin's
  // gradient blows the systemMessage past the host's ~10KB inline cap (previews
  // instead of rendering). B/W run-length-encodes to ~half the bytes and scans
  // the same on Terminal.app.
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "Apple_Terminal" };
  assert.equal(qrRenderMode(env), "coin-full");
  assert.equal(renderQrForTerminal(URL, { env }).renderer, "renderQrFullBw");
});

test("NO_COLOR selects the reverse-video QR", () => {
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "Apple_Terminal", NO_COLOR: "1" };
  assert.equal(qrRenderMode(env), "reverse");
  assert.equal(renderQrForTerminal(URL, { env }).renderer, "renderQrReverse");
});

test("the Apple_Terminal coin uses solid 256-color bg cells, not half-block glyphs", () => {
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "Apple_Terminal" };
  const out = renderQrForTerminal(URL, { env }).qr;
  assert.match(out, /\x1b\[48;5;\d+m/);  // 256-color background cells
  assert.doesNotMatch(out, /[▀▄█]/);     // no half-block glyphs (those are what Terminal.app distorts)
});

test("the default coin uses 256-color, not 24-bit (keeps the nudge under the host render cap)", () => {
  const env = { TERM: "xterm-256color" };
  const out = renderQrForTerminal(URL, { env }).qr;
  assert.match(out, /\x1b\[(38|48);5;\d+m/);   // 256-color escapes
  assert.doesNotMatch(out, /\x1b\[(38|48);2;/); // no 24-bit truecolor escapes
});

test("HAMSTER_QR_RENDER overrides the auto choice", () => {
  const env = { TERM: "xterm-256color", HAMSTER_QR_RENDER: "coin-full" };
  assert.equal(qrRenderMode(env), "coin-full");
});
