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

test("claude wires the greeting, the per-prompt nudge, and the wallet command", () => {
  assert.deepEqual(Object.keys(claudeConfig.hooks), ["SessionStart", "UserPromptSubmit", "UserPromptExpansion"]);
});

test("codex wires per-prompt hooks under UserPromptSubmit only — never SessionStart or UserPromptExpansion", () => {
  // Codex has no UserPromptExpansion event, so the wallet command rides the
  // per-prompt UserPromptSubmit instead (the brain checks the prompt text).
  assert.deepEqual(Object.keys(codexConfig.hooks), ["UserPromptSubmit"]);
  assert.equal(codexConfig.hooks.SessionStart, undefined);
  assert.equal(codexConfig.hooks.UserPromptExpansion, undefined);
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
    const nudge = config.hooks.UserPromptSubmit[0];
    assert.equal(nudge.matcher, undefined, "takes no matcher — fires on every prompt");
    assert.equal(nudge.hooks.length, 1, "the nudge group runs one command");
    assert.equal(nudge.hooks[0].type, "command");
    assert.equal(nudge.hooks[0].shell, undefined, "hook is not shell-specific");
  }
  // The nudge group is byte-identical across runtimes. (The wallet hook is NOT:
  // Claude routes it through UserPromptExpansion, Codex through a second
  // UserPromptSubmit group — so the full arrays intentionally differ.)
  assert.deepEqual(codexConfig.hooks.UserPromptSubmit[0], claudeConfig.hooks.UserPromptSubmit[0]);
});

const WALLET_CMD = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/wallet\/start-wallet\.js"$/;
const TOGGLE_CMD = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/toggle-hook\.js"$/;

// Each slash command Claude services via UserPromptExpansion: matcher -> launcher.
const EXPANSION_COMMANDS = [
  { name: "wallet", matcher: "(^|:)wallet$", cmd: WALLET_CMD },
  { name: "toggle-hamster", matcher: "(^|:)toggle-hamster$", cmd: TOGGLE_CMD },
];

test("claude services the slash commands via UserPromptExpansion (no model turn)", () => {
  const groups = claudeConfig.hooks.UserPromptExpansion;
  assert.equal(groups.length, EXPANSION_COMMANDS.length, "one expansion group per command");
  for (const { matcher, cmd } of EXPANSION_COMMANDS) {
    const g = groups.find((x) => x.matcher === matcher);
    assert.ok(g, `has an expansion group for ${matcher}`);
    assert.equal(g.hooks.length, 1);
    const h = g.hooks[0];
    assert.equal(h.type, "command");
    assert.equal(h.shell, undefined, "cross-platform node launcher, not shell-specific");
    assert.match(h.command, cmd);
    assert.equal(h.commandWindows, h.command);
  }
});

test("codex services those commands via extra UserPromptSubmit hooks (no expansion event)", () => {
  const groups = codexConfig.hooks.UserPromptSubmit;
  // nudge (always) + one per expansion command.
  assert.equal(groups.length, 1 + EXPANSION_COMMANDS.length, "nudge + wallet + toggle");
  for (const { cmd } of EXPANSION_COMMANDS) {
    const g = groups.find((x) => x.hooks.length === 1 && cmd.test(x.hooks[0].command));
    assert.ok(g, `has a UserPromptSubmit group for ${cmd}`);
    assert.equal(g.matcher, undefined, "fires on every prompt; the brain checks the text");
    assert.equal(g.hooks[0].type, "command");
    assert.equal(g.hooks[0].shell, undefined);
    assert.equal(g.hooks[0].commandWindows, g.hooks[0].command);
  }
});

test("both runtimes launch each command through the same cross-platform brain", () => {
  for (const { matcher, cmd } of EXPANSION_COMMANDS) {
    const claudeCmd = claudeConfig.hooks.UserPromptExpansion.find((g) => g.matcher === matcher).hooks[0].command;
    const codexCmd = codexConfig.hooks.UserPromptSubmit.find(
      (g) => g.hooks.length === 1 && cmd.test(g.hooks[0].command),
    ).hooks[0].command;
    assert.equal(claudeCmd, codexCmd);
  }
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
