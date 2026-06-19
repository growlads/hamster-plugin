// hook-debug.js — opt-in capture of what each hook actually receives on stdin.
//
// Off by default. Enable with HAMSTER_HOOK_DEBUG=1 (env) or HAMSTER_HOOK_DEBUG=1
// in ~/.hamster/config. When on, every wired brain appends one JSON line per
// invocation to ~/.hamster/hook-debug.log recording the event name, the prompt /
// command_name it saw, and the full key set — the ground truth for how a given
// runtime routes a slash command vs a skill. Never throws: a debug aid must never
// disrupt a hook.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEnvFile } = require("./provision.js");

function truthy(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "1" || s === "true";
}

function configPath() {
  return process.env.HAMSTER_CONFIG || path.join(os.homedir(), ".hamster", "config");
}

// env wins; otherwise read the saved config (the toggle brain doesn't go through
// launch.js, so the flag isn't always exported into the environment).
function debugOn() {
  if (truthy(process.env.HAMSTER_HOOK_DEBUG)) return true;
  try {
    return truthy(loadEnvFile(configPath()).HAMSTER_HOOK_DEBUG);
  } catch {
    return false;
  }
}

function logEvent(source, hook) {
  if (!debugOn()) return;
  try {
    const dir = path.join(os.homedir(), ".hamster");
    fs.mkdirSync(dir, { recursive: true });
    const rec = {
      ts: new Date().toISOString(),
      source, // which brain logged it: "nudge" | "wallet" | "toggle"
      event: hook && hook.hook_event_name,
      prompt: hook && hook.prompt,
      command_name: hook && hook.command_name,
      keys: hook && typeof hook === "object" ? Object.keys(hook) : [],
    };
    fs.appendFileSync(path.join(dir, "hook-debug.log"), JSON.stringify(rec) + "\n");
  } catch {
    /* never disrupt a hook */
  }
}

module.exports = { logEvent, debugOn };
