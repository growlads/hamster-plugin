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

test("Apple Terminal selects the full-size coin (same design, 256-color)", () => {
  const env = { TERM: "xterm-256color", TERM_PROGRAM: "Apple_Terminal" };
  assert.equal(qrRenderMode(env), "coin-full");
  assert.equal(renderQrForTerminal(URL, { env }).renderer, "renderQrCoin");
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

test("HAMSTER_QR_RENDER overrides the auto choice", () => {
  const env = { TERM: "xterm-256color", HAMSTER_QR_RENDER: "coin-full" };
  assert.equal(qrRenderMode(env), "coin-full");
});
