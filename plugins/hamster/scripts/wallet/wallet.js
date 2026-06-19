#!/usr/bin/env node
/*
 * wallet.js — wallet command brain.
 *
 * Renders the user's earnings card directly from the backend, with NO model turn:
 * the wallet is a deterministic readout, so a hook can service /wallet entirely.
 * Replaces the old flow where /hamster:wallet expanded into a prompt and the LLM
 * formatted the ledger (latency + tokens for fixed output). The skill stays as the
 * fallback for conversational asks ("how much have I made?") — see wallet/SKILL.md.
 *
 * Fires from two hooks (see ../qr/start-wallet.js + hooks.*.json):
 *   • Claude  — UserPromptExpansion, matcher (^|:)wallet$  → the event only fires
 *     for the wallet command, so we always render.
 *   • Codex   — UserPromptSubmit (no expansion hook exists), which fires on EVERY
 *     prompt; we render only when the whole prompt IS the wallet command, else we
 *     stay silent so the QR nudge (the other UserPromptSubmit hook) proceeds.
 *
 * Output contract: { decision: "block", reason }. For UserPromptExpansion `reason`
 * is the channel that actually renders to the user (systemMessage isn't surfaced
 * there — see ../../disabled/scripts/qr/render-qr.js), and block keeps the command
 * from also reaching the model. The same envelope short-circuits Codex's
 * UserPromptSubmit. Always exits 0; a wallet readout must never wedge a prompt.
 */
"use strict";

const path = require("path");
const { buildWallet, isWalletCommand } = require(path.join(__dirname, "wallet-card.js"));
const { logEvent } = require(path.join(__dirname, "..", "hook-debug.js"));

// Prefer IPv4 for the backend call (see nudge.js for the Happy-Eyeballs rationale).
try { require("dns").setDefaultResultOrder("ipv4first"); } catch { /* node < 16.4 */ }

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

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

/**
 * Should this hook invocation render the wallet?
 *   • UserPromptExpansion (Claude): yes — the matcher already gated the event to
 *     the wallet command, so command_name is always wallet here.
 *   • Anything else (Codex UserPromptSubmit, or no event name): only when the whole
 *     prompt is the explicit wallet command, so conversational prompts fall through
 *     to the QR nudge / the LLM skill untouched.
 */
function shouldRender(hook) {
  if (hook && hook.hook_event_name === "UserPromptExpansion") return true;
  return isWalletCommand(hook && hook.prompt);
}

/** GET /v1/stats with the per-user token (resolved into env by launch.js). Returns
 *  { stats } on success or { error } describing why, so the caller can render a
 *  friendly card either way. Never throws. /v1/stats is a pure ledger read (no
 *  Besitos call), so 8s comfortably clears even a cold worker. */
async function fetchStats(ms) {
  const api = (process.env.HAMSTER_API_URL || "http://localhost:8787").replace(/\/+$/, "");
  const token = process.env.HAMSTER_TOKEN || "";
  if (!token) return { error: "not_configured", api };
  try {
    const r = await fetchWithTimeout(api + "/v1/stats", { headers: { Authorization: "Bearer " + token } }, ms);
    if (!r.ok) return { error: "backend", status: r.status, api };
    return { stats: await r.json() };
  } catch {
    return { error: "unreachable", api };
  }
}

// Short, branded fallbacks when there's no card to draw. Plain text (the card adds
// its own color); kept terse since they ride in the blocked-command reason.
function errorBody(res) {
  if (res.error === "not_configured") {
    return [
      "🐹 hamster isn't connected yet.",
      "",
      "It mints a token automatically on first run — this usually means Node isn't",
      "on PATH or the backend was unreachable. Retry in a moment, or set a token in",
      "~/.hamster/config:  HAMSTER_TOKEN=<your token>",
    ].join("\n");
  }
  return "🐹 Couldn't reach your hamster wallet right now. Give it a moment and run /wallet again.";
}

async function run() {
  const hook = await readStdin().then((raw) => { try { return JSON.parse(raw); } catch { return {}; } });
  logEvent("wallet", hook);

  // Not a wallet request → emit nothing. On Codex this lets the QR nudge proceed.
  if (!shouldRender(hook)) done(null);

  const res = await fetchStats(8000);
  const body = res.stats ? buildWallet(res.stats, { color: !process.env.NO_COLOR }) : errorBody(res);

  // block keeps the command off the model; reason is the rendered card.
  done({ decision: "block", reason: "\n" + body + "\n" });
}

// Auto-run as the hook brain (start-wallet.js require()s this via launch.js). Tests
// set HAMSTER_NO_AUTORUN to import the pure helpers without firing stdin/network.
if (!process.env.HAMSTER_NO_AUTORUN) run();

module.exports = { shouldRender, fetchStats, errorBody };
