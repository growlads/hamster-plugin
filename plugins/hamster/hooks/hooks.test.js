"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Per-runtime hooks files, each pointed at by that runtime's own manifest:
//   .claude-plugin/plugin.json -> hooks/hooks.claude.json  (SessionStart + nudge)
//   .codex-plugin/plugin.json  -> hooks/hooks.codex.json   (nudge only)
// Codex fires SessionStart late (on the first prompt), where the codex-banner launch
// wrapper already greets — so Codex must never even register a SessionStart hook.
const claudeConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "hooks.claude.json"), "utf8"));
const codexConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "hooks.codex.json"), "utf8"));

// THE load-bearing invariant. Both runtimes auto-discover a bare hooks/hooks.json,
// and Codex's manifest `hooks` field is ADDITIVE — it does NOT suppress that
// auto-discovery (verified the hard way via ~/.codex/config.toml [hooks.state]). So a
// stray hooks/hooks.json would resurrect SessionStart on Codex. There must be none;
// each runtime gets ONLY its explicit, manifest-named file.
test("there is no auto-discoverable hooks.json", () => {
  assert.equal(
    fs.existsSync(path.join(__dirname, "hooks.json")),
    false,
    "a bare hooks/hooks.json would be auto-discovered by Codex and re-add SessionStart",
  );
});

test("claude wires the greeting and the per-prompt nudge", () => {
  assert.deepEqual(Object.keys(claudeConfig.hooks), ["SessionStart", "UserPromptSubmit"]);
});

test("codex wires ONLY the per-prompt nudge — never SessionStart", () => {
  assert.deepEqual(Object.keys(codexConfig.hooks), ["UserPromptSubmit"]);
  assert.equal(codexConfig.hooks.SessionStart, undefined);
});

test("the greeting runs once at session startup (claude)", () => {
  const groups = claudeConfig.hooks.SessionStart;
  assert.equal(groups.length, 1, "SessionStart has one matcher group");
  assert.equal(groups[0].matcher, "startup", "does not run on resume, clear, or compact");
  assert.equal(groups[0].hooks.length, 1, "SessionStart runs one command");
  assert.equal(groups[0].hooks[0].type, "command");
  assert.equal(groups[0].hooks[0].shell, undefined, "hook is not shell-specific");
});

test("the QR nudge runs on every prompt submit, identically on both runtimes", () => {
  for (const config of [claudeConfig, codexConfig]) {
    const groups = config.hooks.UserPromptSubmit;
    assert.equal(groups.length, 1, "UserPromptSubmit has one group");
    assert.equal(groups[0].matcher, undefined, "takes no matcher — fires on every prompt");
    assert.equal(groups[0].hooks.length, 1, "UserPromptSubmit runs one command");
    assert.equal(groups[0].hooks[0].type, "command");
    assert.equal(groups[0].hooks[0].shell, undefined, "hook is not shell-specific");
  }
  assert.deepEqual(codexConfig.hooks.UserPromptSubmit, claudeConfig.hooks.UserPromptSubmit);
});

test("hook commands use the cross-platform node launchers", () => {
  const welcome = claudeConfig.hooks.SessionStart[0].hooks[0];
  assert.match(welcome.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/qr\/start-welcome\.js"$/);
  assert.equal(welcome.commandWindows, welcome.command);

  const nudge = claudeConfig.hooks.UserPromptSubmit[0].hooks[0];
  assert.match(nudge.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/qr\/start-nudge\.js"$/);
  assert.equal(nudge.commandWindows, nudge.command);
});

test("each manifest points at its own runtime's hooks file", () => {
  const claudeManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".claude-plugin", "plugin.json"), "utf8"),
  );
  const codexManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", ".codex-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(claudeManifest.hooks, "./hooks/hooks.claude.json");
  assert.equal(codexManifest.hooks, "./hooks/hooks.codex.json");
});
