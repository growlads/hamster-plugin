#!/usr/bin/env node
/*
 * provision.js — self-provisioning for the Hamster plugin.
 *
 * On first run it mints a per-user token (POST /v1/register) and writes it to
 * ~/.hamster/config along with the backend URL, so installing the plugin is just
 * install + restart — no manual token/curl step. Idempotent: once a token
 * exists (env or config) it does nothing. Fails soft on any error (offline, no
 * backend, unwritable config) — provisioning must never disrupt a session, so it
 * always exits 0 and prints nothing (its stdout would otherwise reach the model
 * on the SessionStart hook).
 *
 * URL/token resolution order, applied here and in the shell handlers:
 *   environment variable  >  ~/.hamster/config  >  plugin hamster.defaults
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Prefer IPv4 for the backend call (see nudge.js for the Happy-Eyeballs rationale).
try { require("dns").setDefaultResultOrder("ipv4first"); } catch { /* node < 16.4 */ }

// --- pure helpers (unit-tested in provision.test.js) ------------------------

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Resolve the backend URL: env > user config > shipped defaults; no trailing slash. */
function resolveApiUrl({ env, userConfig, defaults }) {
  return firstNonEmpty(
    env && env.HAMSTER_API_URL,
    userConfig && userConfig.HAMSTER_API_URL,
    defaults && defaults.HAMSTER_API_URL,
  ).replace(/\/+$/, "");
}

/** The currently-configured token (env beats config); "" if none. */
function currentToken({ env, userConfig }) {
  return firstNonEmpty(env && env.HAMSTER_TOKEN, userConfig && userConfig.HAMSTER_TOKEN);
}

/**
 * Rewrite a KEY=value config body, updating the given keys in place and
 * preserving everything else (comments, blanks, unknown keys). Missing keys are
 * appended. Returns a string with a single trailing newline.
 */
function mergeConfig(existingText, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = String(existingText || "").split(/\r?\n/);
  const out = lines.map((line) => {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && remaining.has(m[2])) {
      const key = m[2];
      const val = remaining.get(key);
      remaining.delete(key);
      return `${key}=${val}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop(); // we own the trailing newline
  for (const [key, val] of remaining) out.push(`${key}=${val}`);
  return out.join("\n") + "\n";
}

// --- IO / network (exercised by manual verification) ------------------------

/** Parse a KEY=value file into an object; missing/unreadable file → {}. */
function loadEnvFile(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, "utf8"); } catch { return {}; }
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

/** POST /v1/register and return the minted token, or "" on any failure. */
async function register(apiUrl, fetchImpl = globalThis.fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetchImpl(apiUrl + "/v1/register", { method: "POST", signal: ctrl.signal });
    if (!r.ok) return "";
    const data = await r.json();
    return data && data.token ? String(data.token) : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Write the config atomically with owner-only perms (0600). */
function writeConfigAtomic(configPath, text) {
  const tmp = `${configPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* best effort (e.g. Windows) */ }
  fs.renameSync(tmp, configPath);
  try { fs.chmodSync(configPath, 0o600); } catch { /* best effort */ }
}

/**
 * Best-effort exclusive lock so two concurrent sessions can't both register.
 * Returns a fd on success, or null if another process holds a fresh lock.
 * Reclaims a stale lock (>60s old) left by a crashed run.
 */
function acquireLock(lockPath) {
  try {
    return fs.openSync(lockPath, "wx");
  } catch (e) {
    if (!e || e.code !== "EEXIST") return null;
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > 60000) {
        fs.unlinkSync(lockPath);
        return fs.openSync(lockPath, "wx");
      }
    } catch { /* lost the race or stat failed */ }
    return null;
  }
}

async function main() {
  try {
    const configPath = process.env.HAMSTER_CONFIG || path.join(os.homedir(), ".hamster", "config");
    const defaultsPath = path.join(__dirname, "..", "hamster.defaults");

    const defaults = loadEnvFile(defaultsPath);
    const userConfig = loadEnvFile(configPath);
    const env = process.env;

    // Idempotent: a token already exists → nothing to do.
    if (currentToken({ env, userConfig })) return;

    const apiUrl = resolveApiUrl({ env, userConfig, defaults });
    if (!apiUrl) return;

    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });

    const lockPath = path.join(dir, ".provision.lock");
    const lockFd = acquireLock(lockPath);
    if (lockFd == null) return; // another session is provisioning

    try {
      const token = await register(apiUrl);
      if (!token) return;
      const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      const merged = mergeConfig(existing, { HAMSTER_API_URL: apiUrl, HAMSTER_TOKEN: token });
      writeConfigAtomic(configPath, merged);
    } finally {
      try { fs.closeSync(lockFd); } catch { /* ignore */ }
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    }
  } catch {
    // Fail soft — never disrupt a session.
  }
}

module.exports = {
  firstNonEmpty,
  mergeConfig,
  resolveApiUrl,
  currentToken,
  loadEnvFile,
  register,
  writeConfigAtomic,
  main,
};

if (require.main === module) {
  main();
}
