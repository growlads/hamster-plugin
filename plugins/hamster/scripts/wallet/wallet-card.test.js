"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildWallet, isWalletCommand, credits } = require("./wallet-card.js");

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (s) => s.replace(ANSI, "");

// A representative stats payload (the shape /v1/stats returns, see wallet/SKILL.md).
// Every ad action grants a flat 10 credits, so totals are multiples of 10:
// 10 rewards (100 lifetime), one 10-credit reversal → 90 balance.
const STATS = {
  balance_usd: 90.0,
  lifetime_usd: 100.0,
  reversed_usd: 10.0,
  sessions_count: 3,
  recent_total: 23,
  has_more: true,
  recent: [
    { date: "2026-06-18", game: "Coin Quest", note: "level 5", amount_usd: 10.0, reversed: false },
    { date: "2026-06-17", game: "Bubble Pop Saga Deluxe", note: "install", amount_usd: 10.0, reversed: false },
    { date: "2026-06-16", game: "Merge Mansion", note: "clawback", amount_usd: 10.0, reversed: true },
  ],
};

test("credits formats as a whole number with a credits suffix", () => {
  assert.equal(credits(20), "20 credits");
  assert.equal(credits(1234), "1,234 credits"); // thousands separator, no decimals
  assert.equal(credits(0), "0 credits");
  assert.equal(credits(null), "0 credits");
  assert.equal(credits("nonsense"), "0 credits");
});

test("buildWallet leads with balance and lifetime", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  assert.match(out, /90 credits/, "shows balance");
  assert.match(out, /100 credits/, "shows lifetime earned");
  assert.match(out, /balance/i);
  assert.match(out, /lifetime/i);
});

test("buildWallet lists recent rewards with game and amount", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  assert.match(out, /Coin Quest/);
  assert.match(out, /10 credits/);
});

test("reversed rows are flagged and not shown as positive", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  // The clawback amount appears with a minus sign, never as a bare +10.00 credits.
  assert.match(out, /-\s?10 credits|−10 credits/, "reversed amount shown as negative");
  assert.match(out, /revers|↩/i, "reversed row is tagged");
});

test("context line shows sessions and reversed total only when relevant", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  assert.match(out, /3 sessions/);
  assert.match(out, /10 credits reversed/);

  // No reversed total (or row) when nothing was clawed back.
  const clean = plain(
    buildWallet(
      { ...STATS, reversed_usd: 0, recent: STATS.recent.filter((r) => !r.reversed) },
      { color: false },
    ),
  );
  assert.doesNotMatch(clean, /reversed/i);
});

test("footer offers older entries when has_more", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  // 23 total, 3 shown -> 20 older.
  assert.match(out, /20 older|of 23|older/i);
});

test("ISO timestamps are trimmed to the calendar day", () => {
  const out = plain(
    buildWallet(
      { ...STATS, recent: [{ date: "2026-06-16T06:00:46.921Z", game: "Spins", amount_usd: 10.0, reversed: false }] },
      { color: false },
    ),
  );
  assert.match(out, /2026-06-16/, "shows the day");
  assert.doesNotMatch(out, /T06:00|\.921Z/, "drops the time portion");
});

test("empty ledger shows an encouraging line, no table", () => {
  const out = plain(buildWallet({ ...STATS, recent: [], recent_total: 0, has_more: false }, { color: false }));
  assert.match(out, /no rewards yet/i);
});

test("always closes with the credits-land expectation setter", () => {
  const out = plain(buildWallet(STATS, { color: false }));
  assert.match(out, /Credits land ~15 min/i);
});

test("color:false emits zero ANSI escapes; color:true emits some", () => {
  const mono = buildWallet(STATS, { color: false });
  assert.equal(mono, plain(mono), "no escapes when color is off");

  const colored = buildWallet(STATS, { color: true });
  assert.notEqual(colored, plain(colored), "has escapes when color is on");
  assert.match(plain(colored), /90 credits/, "still renders the same content");
});

test("isWalletCommand matches the explicit command forms only", () => {
  for (const yes of [
    "/wallet", "/hamster:wallet", "wallet", "  /wallet  ", "WALLET", "/Wallet",
    "$wallet", "$hamster:wallet", // Codex prefixes with $
  ]) {
    assert.equal(isWalletCommand(yes), true, `should match: ${JSON.stringify(yes)}`);
  }
  for (const no of [
    "what's in my wallet",
    "show my wallet balance",
    "wallets",
    "/wallet please",
    "how much have I earned",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isWalletCommand(no), false, `should NOT match: ${JSON.stringify(no)}`);
  }
});
