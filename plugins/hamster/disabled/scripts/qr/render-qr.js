#!/usr/bin/env node
/*
 * render-qr.js — render a scannable QR code using Unicode half-block characters,
 * with no native dependencies (qrencode is not assumed present).
 *
 * Modes:
 *   --featured  fetch the rotating featured game from the backend
 *               (HAMSTER_API_URL + HAMSTER_TOKEN env) and QR its monitored
 *               go_url, so scanning installs the game attributed to this user.
 *   <url> [lbl] QR an explicit URL (used for testing / ad-hoc links).
 *   --raw       print plain text instead of the hook envelope (standalone use).
 *
 * Default output is a Claude Code UserPromptExpansion hook envelope as JSON:
 *   { decision: "block", reason, systemMessage }
 * The QR + instructions ride in systemMessage so they surface to the terminal,
 * and `block` keeps the bare command from also reaching the model.
 */
"use strict";

const path = require("path");
const { renderQrBlock } = require(path.join(__dirname, "qr-block.js"));

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const featured = args.includes("--featured");
const positional = args.filter((a) => !a.startsWith("--"));

function emit(message) {
  if (raw) {
    process.stdout.write(message + "\n");
    return;
  }
  // For UserPromptExpansion, `reason` is the channel that actually renders to
  // the user (systemMessage is not surfaced here). So the QR + instructions
  // ride in reason; decision:block keeps the bare command from reaching the model.
  process.stdout.write(JSON.stringify({ decision: "block", reason: "\n" + message + "\n" }));
}

function qrMessage(url, label) {
  return [
    label,
    "",
    renderQrBlock(url),
    "",
    "Scan with your phone's camera to install the game and start earning while",
    "Claude keeps working. Prefer a tap? Open this link on your phone:",
    "",
    "  " + url,
  ].join("\n");
}

// fetch with a hard timeout. Generous because /v1/featured can make a cold
// upstream call to the backend (~2s, then cached server-side for ~2 min).
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

async function resolveFeatured() {
  const api = (process.env.HAMSTER_API_URL || "http://localhost:8787").replace(/\/+$/, "");
  const token = process.env.HAMSTER_TOKEN || "";
  if (!token) {
    return {
      error:
        "hamster isn't connected yet. Register a token and save it to " +
        "~/.hamster/config, then run /qr again:\n\n  curl -s -X POST " +
        api +
        "/v1/register",
    };
  }
  try {
    const r = await fetchWithTimeout(api + "/v1/featured", { headers: { Authorization: "Bearer " + token } }, 6000);
    if (r.status === 404) return { error: "No rewarded games are available right now. Try again shortly." };
    if (!r.ok) return { error: "The backend returned " + r.status + " for /v1/featured." };
    const game = (await r.json()).game || {};
    const url = game.go_url || game.click_url;
    if (!url) return { error: "No rewarded games are available right now. Try again shortly." };
    const reward = typeof game.reward_usd_total === "number" ? game.reward_usd_total.toFixed(2) : null;
    const label = (game.title || "Play & earn") + (reward ? "  ·  earn up to $" + reward : "");
    return { url, label };
  } catch (e) {
    return { error: "Couldn't reach the Hamster backend at " + api + ". Check your connection (or HAMSTER_API_URL in ~/.hamster/config), then run /qr again." };
  }
}

(async () => {
  if (featured) {
    const res = await resolveFeatured();
    if (res.error) return emit(res.error);
    return emit(qrMessage(res.url, res.label));
  }
  const url = positional[0];
  if (!url) {
    process.stderr.write("render-qr.js: missing url (or pass --featured)\n");
    process.exit(1);
  }
  emit(qrMessage(url, positional[1] || "Scan to play on your phone"));
})();
