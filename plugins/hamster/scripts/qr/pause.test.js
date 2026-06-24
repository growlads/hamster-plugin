"use strict";
/*
 * Tests for the pause gate that wires /hamster:toggle-hamster through to the
 * QR nudge and the welcome card. These are the bits that, if wrong, would either
 * keep showing QRs after a pause or hide them forever.
 *
 * Run: node --test plugins/hamster/scripts/qr/pause.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

// nudge.js auto-runs its stdin/network flow on require; this env var imports the
// pure helpers without firing it.
process.env.HAMSTER_NO_AUTORUN = "1";
const { isPaused, buildNudge, buildEarnings } = require("./nudge.js");
const { buildWelcome } = require("./welcome-card.js");
const { isPausedValue } = require("../toggle-pause.js");

// Strip ANSI so copy assertions don't depend on whether color is on (the styled
// "wallet" word would otherwise break a contiguous-text match).
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("isPaused treats only 1/true (case-insensitive) as paused", () => {
  assert.equal(isPaused({ HAMSTER_PAUSED: "1" }), true);
  assert.equal(isPaused({ HAMSTER_PAUSED: "true" }), true);
  assert.equal(isPaused({ HAMSTER_PAUSED: "TRUE" }), true);
  assert.equal(isPaused({ HAMSTER_PAUSED: " 1 " }), true);
  assert.equal(isPaused({ HAMSTER_PAUSED: "0" }), false);
  assert.equal(isPaused({ HAMSTER_PAUSED: "false" }), false);
  assert.equal(isPaused({ HAMSTER_PAUSED: "" }), false);
  assert.equal(isPaused({}), false);
});

test("isPausedValue (toggle) matches the nudge gate semantics", () => {
  assert.equal(isPausedValue("1"), true);
  assert.equal(isPausedValue("true"), true);
  assert.equal(isPausedValue("TRUE"), true);
  assert.equal(isPausedValue("0"), false);
  assert.equal(isPausedValue(undefined), false);
  assert.equal(isPausedValue(null), false);
  assert.equal(isPausedValue(""), false);
});

test("nudge copy shows the credits badge + run-wallet credit CTA when a reward is present", () => {
  // Every ad action grants the flat reward (REWARD_CREDITS, default 10).
  const card = plain(buildNudge({ title: "Coin Quest", url: "https://x/go", reward: "10.00" }));
  assert.match(card, /10\.00 credits/);
  assert.match(card, /EARN WHILE YOU CODE/);
  assert.match(card, /Scan to start/);
  assert.match(card, /Credits land ~15 min later\./);
  // Points at the wallet skill as /wallet (short form), not the long namespaced one.
  assert.match(card, /Run \/wallet to check them\./);
  assert.doesNotMatch(card, /\/hamster:wallet/);
});

test("nudge omits the credits badge gracefully when reward is null", () => {
  const card = buildNudge({ title: "Coin Quest", url: "https://x/go", reward: null });
  assert.doesNotMatch(card, /\d+\.\d{2} credits/);
  assert.match(card, /Coin Quest/);
});

test("earnings banner pluralizes rewards and shows the formatted total + wallet CTA", () => {
  // 3 ad actions at the flat 10 each → 30.00 credits.
  const many = plain(buildEarnings({ count: 3, total: "30.00" }));
  assert.match(many, /\+30\.00 credits earned while you coded/);
  assert.match(many, /3 rewards cleared/);
  assert.match(many, /run \/wallet to see the breakdown/);

  const one = plain(buildEarnings({ count: 1, total: "10.00" }));
  assert.match(one, /\+10\.00 credits earned while you coded/);
  assert.match(one, /1 reward cleared/);
  assert.doesNotMatch(one, /1 rewards/); // singular, not "1 rewards"
});

test("welcome ACTIVE shows the LIVE chip + value line, no wallet command", () => {
  const card = buildWelcome({ paused: false });
  assert.match(card, /LIVE/);
  assert.match(card, /Play while you wait, earn while Claude codes\./);
  assert.doesNotMatch(card, /PAUSED/);
  assert.doesNotMatch(card, /\/hamster:wallet/);
});

test("welcome names the given agent in the value line (Codex on the Codex banner)", () => {
  assert.match(buildWelcome({ agent: "Codex" }), /earn while Codex codes\./);
  // Default surface is Claude.
  assert.match(buildWelcome(), /earn while Claude codes\./);
});

test("welcome PAUSED swaps in the muted chip + resume hint", () => {
  const card = buildWelcome({ paused: true });
  assert.match(card, /PAUSED/);
  assert.match(card, /toggle-hamster/);
  assert.doesNotMatch(card, /LIVE/);
});

test("buildWelcome defaults to ACTIVE when called with no args", () => {
  const card = buildWelcome();
  assert.match(card, /LIVE/);
  assert.doesNotMatch(card, /PAUSED/);
});
