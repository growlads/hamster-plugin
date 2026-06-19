"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { isToggleCommand, applyToggle, isPausedValue } = require("./toggle-pause.js");

// Import the hook brain's decision logic without firing its stdin/write flow.
process.env.HAMSTER_NO_AUTORUN = "1";
const { shouldRender } = require("./toggle-hook.js");

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hamster-toggle-"));
  return path.join(dir, "config");
}

test("isToggleCommand matches the explicit command forms only", () => {
  for (const yes of [
    "/toggle-hamster",
    "/hamster:toggle-hamster",
    "toggle-hamster",
    "  /toggle-hamster  ",
    "TOGGLE-HAMSTER",
    "$toggle-hamster", // Codex prefixes with $
    "$hamster:toggle-hamster",
  ]) {
    assert.equal(isToggleCommand(yes), true, `should match: ${JSON.stringify(yes)}`);
  }
  for (const no of [
    "toggle the hamster",
    "pause hamster",
    "/toggle-hamster please",
    "toggle-hamsters",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isToggleCommand(no), false, `should NOT match: ${JSON.stringify(no)}`);
  }
});

test("applyToggle flips an active config to paused and persists it", () => {
  const cfg = tmpConfig();
  fs.writeFileSync(cfg, "HAMSTER_TOKEN=abc\nHAMSTER_PAUSED=0\n");

  const res = applyToggle(cfg);
  assert.equal(res.paused, true);
  assert.match(res.message, /paused/i);
  // Persisted, and unrelated keys preserved.
  const after = fs.readFileSync(cfg, "utf8");
  assert.match(after, /HAMSTER_PAUSED=1/);
  assert.match(after, /HAMSTER_TOKEN=abc/);
});

test("applyToggle flips back to live on the next call (it's a toggle)", () => {
  const cfg = tmpConfig();
  fs.writeFileSync(cfg, "HAMSTER_PAUSED=1\n");

  const res = applyToggle(cfg);
  assert.equal(res.paused, false);
  assert.match(res.message, /live/i);
  assert.equal(isPausedValue(require("./provision.js").loadEnvFile(cfg).HAMSTER_PAUSED), false);
});

test("applyToggle treats a missing config as active → first toggle pauses", () => {
  const cfg = tmpConfig(); // dir exists, file does not
  const res = applyToggle(cfg);
  assert.equal(res.paused, true);
  assert.match(fs.readFileSync(cfg, "utf8"), /HAMSTER_PAUSED=1/);
});

test("UserPromptExpansion always acts — the matcher already gated it", () => {
  assert.equal(shouldRender({ hook_event_name: "UserPromptExpansion" }), true);
});

test("UserPromptSubmit acts only for the explicit toggle command (write guard)", () => {
  // Codex fires this on EVERY prompt — acting on anything else would flip the flag.
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "/toggle-hamster" }), true);
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "toggle-hamster" }), true);
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "keep coding" }), false);
  assert.equal(shouldRender({ prompt: "/toggle-hamster" }), true);
  assert.equal(shouldRender({}), false);
  assert.equal(shouldRender(null), false);
});
