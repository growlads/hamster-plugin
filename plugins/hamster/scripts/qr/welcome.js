#!/usr/bin/env node
/*
 * welcome.js — SessionStart greeting brain.
 *
 * At session startup we show a short, tasteful "hamster · play is installed"
 * card so the user knows the plugin is live — WITHOUT the QR. The QR now rides
 * on every prompt (UserPromptSubmit → nudge.js); this is just the welcome.
 *
 * Same non-contaminating contract as nudge.js: the card rides in `systemMessage`
 * (shown to the user but NOT added to model context); stdout carries only the
 * JSON hook response, and we never set decision:block, so startup proceeds. The
 * per-session marker is a defensive guard against duplicate hook sources
 * greeting twice.
 *
 * Reads the hook JSON (with session_id) from stdin. Stays silent on any problem.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { buildWelcome } = require(path.join(__dirname, "welcome-card.js"));

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

// Has this session already been greeted? Marker file keyed by session_id.
function alreadyGreeted(sessionId) {
  const dir = path.join(os.tmpdir(), "hamster-nudge");
  const safe = "welcome-" + String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
  const marker = path.join(dir, safe);
  try {
    if (fs.existsSync(marker)) return true;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
    return false;
  } catch {
    // If we can't track it, err on the side of NOT greeting repeatedly.
    return true;
  }
}

(async () => {
  const raw = await readStdin();
  let sessionId = "";
  try { sessionId = JSON.parse(raw).session_id || ""; } catch { /* ignore */ }
  // With a session_id we dedupe; without one we still greet (SessionStart fires
  // once at startup), just can't guard against a duplicate hook source.
  if (sessionId && alreadyGreeted(sessionId)) done(null);

  // Lead with a newline so the card starts on its own line under the notice.
  done({ systemMessage: "\n" + buildWelcome() });
})();
