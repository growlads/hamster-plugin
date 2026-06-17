"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isCodexDesktopApp } = require("./launch.js");

// hamster hooks must NOT run inside the Codex desktop app. The app is identified by
// CODEX_INTERNAL_ORIGINATOR_OVERRIDE="Codex Desktop" (observed in ~/.hamster/hook-env.log);
// the npm Codex CLI sets CODEX_MANAGED_BY_NPM instead, and Claude Code sets CLAUDECODE.
test("detects the Codex desktop app", () => {
  assert.equal(isCodexDesktopApp({ CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop" }), true);
  assert.equal(isCodexDesktopApp({ CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex desktop" }), true);
});

test("treats the npm Codex CLI as not-the-app", () => {
  assert.equal(
    isCodexDesktopApp({ CODEX_MANAGED_BY_NPM: "1", CODEX_MANAGED_PACKAGE_ROOT: "/x/@openai/codex" }),
    false,
  );
});

test("treats Claude Code as not-the-app", () => {
  assert.equal(isCodexDesktopApp({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" }), false);
});

test("treats an empty environment as not-the-app", () => {
  assert.equal(isCodexDesktopApp({}), false);
});
