#!/usr/bin/env node
/*
 * launch.js — shared, cross-platform hook launcher.
 *
 * Resolves the backend URL + per-user token (provisioning one on first run via
 * provision.js), exports them to the environment, then runs the given QR "brain"
 * module. Two entry points use it: start-welcome.js (SessionStart greeting) and
 * start-nudge.js (the per-prompt QR). Shell-free so Claude Code and Codex can
 * both run it from one hook command.
 *
 * URL/token resolution order matches provision.js: env > ~/.hamster/config >
 * shipped hamster.defaults. Fails soft — a greeting/nudge must never disrupt a
 * session or a prompt.
 */
"use strict";

const os = require("os");
const path = require("path");
const { loadEnvFile, currentToken, resolveApiUrl, main: provision } = require("../provision.js");

// The Codex DESKTOP APP sets CODEX_INTERNAL_ORIGINATOR_OVERRIDE="Codex Desktop"
// (the npm Codex CLI sets CODEX_MANAGED_BY_NPM instead; Claude Code sets CLAUDECODE).
// We don't want any hamster hook to run inside the desktop app, so this is the skip
// signal. App-vs-CLI can't be split by manifest — both Codex surfaces load the same
// hooks.codex.json — so it has to be a runtime check here. Env param for testability.
function isCodexDesktopApp(env = process.env) {
  return /desktop/i.test(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || "");
}

async function launch(brainModule) {
  if (isCodexDesktopApp()) process.exit(0); // no greeting / QR nudge inside the Codex desktop app
  try {
    const root = path.join(__dirname, "..", "..");
    const configPath = process.env.HAMSTER_CONFIG || path.join(os.homedir(), ".hamster", "config");
    const defaultsPath = path.join(root, "hamster.defaults");

    const defaults = loadEnvFile(defaultsPath);
    let userConfig = loadEnvFile(configPath);

    let apiUrl = resolveApiUrl({ env: process.env, userConfig, defaults });
    let token = currentToken({ env: process.env, userConfig }) || defaults.HAMSTER_TOKEN || "";

    if (!token) {
      process.env.HAMSTER_API_URL = apiUrl;
      await provision();

      userConfig = loadEnvFile(configPath);
      token = currentToken({ env: process.env, userConfig }) || "";
      if (!apiUrl && userConfig.HAMSTER_API_URL) apiUrl = String(userConfig.HAMSTER_API_URL).replace(/\/+$/, "");
    }

    process.env.HAMSTER_API_URL = apiUrl || "";
    process.env.HAMSTER_TOKEN = token || "";

    require(brainModule);
  } catch {
    // A greeting/nudge must never disrupt the session.
    process.exit(0);
  }
}

module.exports = { launch, isCodexDesktopApp };
