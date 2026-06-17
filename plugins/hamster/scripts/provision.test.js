"use strict";
/*
 * Tests for the pure logic in provision.js — the parts that, if wrong, would
 * corrupt a user's ~/.hamster/config or point at the wrong backend. Network
 * (register) and file IO are covered by manual verification, not here.
 *
 * Run: node --test plugins/hamster/scripts/provision.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mergeConfig, resolveApiUrl, currentToken } = require("./provision.js");

test("mergeConfig preserves unknown keys and updates known ones in place", () => {
  const existing = "# my notes\nFOO=bar\nHAMSTER_TOKEN=old\n";
  const out = mergeConfig(existing, {
    HAMSTER_API_URL: "https://hamster.win",
    HAMSTER_TOKEN: "new",
  });
  assert.match(out, /^# my notes$/m, "keeps comments");
  assert.match(out, /^FOO=bar$/m, "keeps unknown keys");
  assert.match(out, /^HAMSTER_TOKEN=new$/m, "updates existing key in place");
  assert.match(out, /^HAMSTER_API_URL=https:\/\/hamster\.win$/m, "adds missing key");
  // No duplicate token lines.
  assert.equal((out.match(/^HAMSTER_TOKEN=/gm) || []).length, 1, "no duplicate token");
  assert.doesNotMatch(out, /HAMSTER_TOKEN=old/, "old value gone");
});

test("mergeConfig writes both keys into an empty file", () => {
  const out = mergeConfig("", { HAMSTER_API_URL: "https://hamster.win", HAMSTER_TOKEN: "t" });
  assert.match(out, /^HAMSTER_API_URL=https:\/\/hamster\.win$/m);
  assert.match(out, /^HAMSTER_TOKEN=t$/m);
  assert.match(out, /\n$/, "ends with a newline");
});

test("resolveApiUrl honors env > config > defaults and strips trailing slash", () => {
  assert.equal(
    resolveApiUrl({
      env: { HAMSTER_API_URL: "http://localhost:8787/" },
      userConfig: { HAMSTER_API_URL: "https://cfg" },
      defaults: { HAMSTER_API_URL: "https://hamster.win" },
    }),
    "http://localhost:8787",
    "env wins, trailing slash stripped",
  );
  assert.equal(
    resolveApiUrl({
      env: {},
      userConfig: { HAMSTER_API_URL: "https://cfg/" },
      defaults: { HAMSTER_API_URL: "https://hamster.win" },
    }),
    "https://cfg",
    "config beats defaults",
  );
  assert.equal(
    resolveApiUrl({ env: {}, userConfig: {}, defaults: { HAMSTER_API_URL: "https://hamster.win" } }),
    "https://hamster.win",
    "falls back to shipped default",
  );
});

test("currentToken returns env or config token, empty when neither", () => {
  assert.equal(currentToken({ env: { HAMSTER_TOKEN: "e" }, userConfig: { HAMSTER_TOKEN: "c" } }), "e");
  assert.equal(currentToken({ env: {}, userConfig: { HAMSTER_TOKEN: "c" } }), "c");
  assert.equal(currentToken({ env: {}, userConfig: {} }), "");
});
