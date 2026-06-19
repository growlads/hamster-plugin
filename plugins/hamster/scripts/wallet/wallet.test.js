"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Import the pure helpers without firing the stdin/network run().
process.env.HAMSTER_NO_AUTORUN = "1";
const { shouldRender, errorBody } = require("./wallet.js");

test("UserPromptExpansion always renders — the matcher already gated it", () => {
  // On Claude the event only fires for the wallet command, so prompt text is moot.
  assert.equal(shouldRender({ hook_event_name: "UserPromptExpansion" }), true);
  assert.equal(
    shouldRender({ hook_event_name: "UserPromptExpansion", command_name: "hamster:wallet" }),
    true,
  );
});

test("UserPromptSubmit renders only for the explicit wallet command", () => {
  // Codex fires this on EVERY prompt — we must not hijack conversational asks.
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "/wallet" }), true);
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "/hamster:wallet" }), true);
  assert.equal(shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "wallet" }), true);
  assert.equal(
    shouldRender({ hook_event_name: "UserPromptSubmit", prompt: "how much is in my wallet?" }),
    false,
  );
});

test("missing/unknown event falls back to the strict command check", () => {
  assert.equal(shouldRender({ prompt: "/wallet" }), true);
  assert.equal(shouldRender({ prompt: "tell me a joke" }), false);
  assert.equal(shouldRender({}), false);
  assert.equal(shouldRender(null), false);
});

test("errorBody explains the not-connected case with the manual-token escape hatch", () => {
  const body = errorBody({ error: "not_configured" });
  assert.match(body, /isn't connected/i);
  assert.match(body, /HAMSTER_TOKEN/);
});

test("errorBody gives a friendly retry for backend/unreachable failures", () => {
  for (const error of ["backend", "unreachable"]) {
    assert.match(errorBody({ error }), /couldn't reach|try again|moment/i);
  }
});
