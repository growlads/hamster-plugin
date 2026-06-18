#!/usr/bin/env node
/*
 * toggle-pause.js — flip the Hamster QR pause flag.
 *
 * Reads ~/.hamster/config (honoring a HAMSTER_CONFIG override, like provision.js),
 * toggles HAMSTER_PAUSED between "1" (paused) and "0" (active), writes it back
 * with the existing mergeConfig/writeConfigAtomic helpers, then prints a one-line
 * confirmation card to stdout. The change takes effect on the next prompt (nudge
 * + welcome read the config fresh via launch.js); the printed line is the
 * immediate in-session feedback.
 *
 * Invoked by the /hamster:toggle-hamster skill. Fails soft — a toggle must never
 * throw and disrupt a session: on any error it prints a short note and exits 0.
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

function main() {
  try {
    const configPath = process.env.HAMSTER_CONFIG || path.join(os.homedir(), ".hamster", "config");

    const userConfig = loadEnvFile(configPath);
    // Current state: config is the source of truth here (the toggle persists to
    // it). We don't fold in the env var — toggling should flip the saved flag.
    const nowPaused = !isPausedValue(userConfig.HAMSTER_PAUSED);

    const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const merged = mergeConfig(existing, { HAMSTER_PAUSED: nowPaused ? "1" : "0" });

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    writeConfigAtomic(configPath, merged);

    process.stdout.write(
      (nowPaused
        ? "⏸ hamster paused — no more QR cards. Run /hamster:toggle-hamster again to resume."
        : "● hamster live — QR cards back on. Earn while you code.") + "\n",
    );
  } catch {
    // Fail soft: never disrupt the session.
    process.stdout.write("hamster: couldn't update the pause flag — try again.\n");
  }
  process.exit(0);
}

module.exports = { isPausedValue, main };

if (require.main === module) {
  main();
}
