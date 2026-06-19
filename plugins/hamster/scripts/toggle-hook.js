#!/usr/bin/env node
/*
 * toggle-hook.js — toggle-hamster command brain.
 *
 * Flips the QR pause flag and prints the confirmation directly, with NO model turn.
 * The toggle-hamster skill is `disable-model-invocation: true` (slash-only) and did
 * nothing but run toggle-pause.js and relay its one line — a whole LLM turn for a
 * fixed side-effect. This services it as a hook instead; the skill stays as the
 * registration + fallback (see skills/toggle-hamster/SKILL.md).
 *
 * Fires from two hooks (see hooks.*.json):
 *   • Claude  — UserPromptExpansion, matcher (^|:)toggle-hamster$  → the event only
 *     fires for the command, so we always act.
 *   • Codex   — UserPromptSubmit (no expansion hook exists), which fires on EVERY
 *     prompt; we act ONLY when the whole prompt is the toggle command. This guard is
 *     load-bearing: applyToggle WRITES, so acting on a non-command prompt would flip
 *     the flag on unrelated input.
 *
 * Unlike the wallet brain this does NOT go through launch.js: toggling is a purely
 * local ~/.hamster/config flip — no token, no backend — so there's nothing to
 * provision and no reason to pay that round-trip just to set a flag.
 *
 * Output: { decision: "block", reason } — reason is the channel that renders to the
 * user for UserPromptExpansion (see ../../disabled/scripts/qr/render-qr.js), and
 * block keeps the command off the model. Always exits 0.
 */
"use strict";

const path = require("path");
const { applyToggle, isToggleCommand } = require(path.join(__dirname, "toggle-pause.js"));

function done(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(data); } };
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 1500); // never hang the prompt
  });
}

/**
 * Should this invocation flip the flag?
 *   • UserPromptExpansion (Claude): yes — the matcher already gated the event to the
 *     toggle command.
 *   • Anything else (Codex UserPromptSubmit, or no event name): only when the whole
 *     prompt is the explicit toggle command, so unrelated prompts never trigger a
 *     write and fall through to the QR nudge untouched.
 */
function shouldRender(hook) {
  if (hook && hook.hook_event_name === "UserPromptExpansion") return true;
  return isToggleCommand(hook && hook.prompt);
}

async function run() {
  const hook = await readStdin().then((raw) => { try { return JSON.parse(raw); } catch { return {}; } });

  // Not the toggle command → emit nothing. On Codex this lets the QR nudge proceed
  // AND, crucially, leaves the pause flag untouched.
  if (!shouldRender(hook)) done(null);

  const { message } = applyToggle();
  done({ decision: "block", reason: "\n" + message + "\n" });
}

// Auto-run as the hook brain. Tests set HAMSTER_NO_AUTORUN to import shouldRender
// without firing the stdin/write flow.
if (!process.env.HAMSTER_NO_AUTORUN) run();

module.exports = { shouldRender };
