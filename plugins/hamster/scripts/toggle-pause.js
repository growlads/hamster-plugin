#!/usr/bin/env node
/*
 * toggle-pause.js — flip the Hamster QR pause flag.
 *
 * Reads ~/.hamster/config (honoring a HAMSTER_CONFIG override, like provision.js),
 * toggles HAMSTER_PAUSED between "1" (paused) and "0" (active), writes it back
 * with the existing mergeConfig/writeConfigAtomic helpers, and reports the new
 * state + a one-line confirmation. The change takes effect on the next prompt
 * (nudge + welcome read the config fresh via launch.js); the confirmation is the
 * immediate in-session feedback.
 *
 * Two callers share applyToggle():
 *   • the toggle-hamster hook brain (../toggle-hook.js) wraps the message in a
 *     UserPromptExpansion / UserPromptSubmit envelope so /toggle-hamster runs with
 *     NO model turn; and
 *   • main() here, kept for standalone use and as the toggle-hamster SKILL fallback
 *     (it prints the plain line and the skill relays it).
 *
 * Fails soft — a toggle must never throw and disrupt a session: on any error it
 * reports a short note and main() exits 0.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEnvFile, mergeConfig, writeConfigAtomic } = require("./provision.js");

// "1"/"true" (case-insensitive) is paused; anything else is active.
function isPausedValue(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "1" || s === "true";
}

/**
 * Is `prompt` the explicit toggle command (not natural language)? Matches the whole
 * prompt being one of: /toggle-hamster, /hamster:toggle-hamster, toggle-hamster
 * (any case, surrounding whitespace ok). Deliberately strict — it gates a WRITE on
 * Codex, where UserPromptSubmit fires on every prompt, so anything looser would
 * flip the flag on unrelated prompts.
 */
function isToggleCommand(prompt) {
  if (prompt == null) return false;
  // Claude sends "/hamster:toggle-hamster", Codex sends "$hamster:toggle-hamster"
  // (verified via ~/.hamster/hook-debug.log). Accept either prefix (or none),
  // namespaced or bare. Anchored — gates a WRITE, so it must not match loosely.
  return /^[/$]?(hamster:)?toggle-hamster$/i.test(String(prompt).trim());
}

/**
 * Flip the saved HAMSTER_PAUSED flag and return { paused, message }. The config file
 * is the source of truth here (the toggle persists to it); we don't fold in the env
 * var, since toggling should flip the saved flag. Never throws — on any IO error it
 * returns { paused: null } with a short note.
 */
function applyToggle(configPath) {
  configPath = configPath || process.env.HAMSTER_CONFIG || path.join(os.homedir(), ".hamster", "config");
  try {
    const userConfig = loadEnvFile(configPath);
    const nowPaused = !isPausedValue(userConfig.HAMSTER_PAUSED);

    const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const merged = mergeConfig(existing, { HAMSTER_PAUSED: nowPaused ? "1" : "0" });

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    writeConfigAtomic(configPath, merged);

    return {
      paused: nowPaused,
      message: nowPaused
        ? "⏸ hamster paused — no more QR cards. Run /hamster:toggle-hamster again to resume."
        : "● hamster live — QR cards back on. Earn while you code.",
    };
  } catch {
    return { paused: null, message: "hamster: couldn't update the pause flag — try again." };
  }
}

function main() {
  process.stdout.write(applyToggle().message + "\n");
  process.exit(0);
}

module.exports = { isPausedValue, isToggleCommand, applyToggle, main };

if (require.main === module) {
  main();
}
