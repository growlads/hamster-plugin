#!/usr/bin/env node
/*
 * codex-banner/install.js — opt-in hamster launch banner for the Codex CLI.
 *
 * Codex's SessionStart hook does NOT fire at launch — it waits for the first
 * prompt (by OpenAI's design). The only way to show something at *real* codex
 * launch is to wrap the npm-installed `codex` launcher shim itself, OUTSIDE the
 * hook system. This installer does exactly that, reversibly:
 *
 *   - discovers the three shims npm generates next to `codex` on PATH
 *     (`codex` POSIX-sh, `codex.cmd` cmd.exe, `codex.ps1` PowerShell);
 *   - backs each up to `codex.hamster-orig.*` (refusing anything that doesn't
 *     look like an @openai/codex shim);
 *   - replaces each with a wrapper that prints ~/.hamster/codex-banner.txt then
 *     exec's the pristine backup (args/stdin/exit-code preserved).
 *
 * It needs NO server and NO daemon: the banner file is plain text, read fresh on
 * every launch, so refreshing it (e.g. from the prompt hooks) needs no re-patch.
 *
 * Commands:  install [text...] | uninstall | status
 *
 * Caveats (see plugins/hamster/AGENTS.md):
 *  - codex is a TUI; it likely uses the alternate screen, so the banner shows at
 *    launch then is covered, reappearing in scrollback after you quit codex.
 *  - a codex npm self-update regenerates the shim and silently drops the wrapper
 *    (codex keeps working) — re-run `install` to reapply.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildWelcome } = require(path.join(__dirname, "..", "qr", "welcome-card.js"));

const MARKER = "HAMSTER-CODEX-BANNER";
const BACKUP_TAG = "hamster-orig";
// Default banner = the exact same card the Claude Code SessionStart hook shows
// (welcome.js), so the launch banner reads identically across both tools.
const DEFAULT_BANNER = buildWelcome();

const isWin = process.platform === "win32";

function hamsterDir() {
  return process.env.HAMSTER_HOME || path.join(os.homedir(), ".hamster");
}
function bannerFile() {
  return path.join(hamsterDir(), "codex-banner.txt");
}
function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* ---- shim discovery ------------------------------------------------------ */

/** Directories on PATH (plus the dir of the resolved `codex`, if any). */
function pathDirs() {
  const sep = isWin ? ";" : ":";
  const dirs = (process.env.PATH || "").split(sep).filter(Boolean);
  return Array.from(new Set(dirs.map((d) => d.replace(/"/g, ""))));
}

/** A file looks like an @openai/codex launcher shim (or our own wrapper). */
function looksLikeCodexShim(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.includes(MARKER) || /@openai[\/\\]codex|codex\.js/.test(raw);
  } catch {
    return false;
  }
}

/** Find codex / codex.cmd / codex.ps1 across PATH; validated + de-duped. */
function findShims() {
  const names = isWin ? ["codex.cmd", "codex.ps1", "codex"] : ["codex"];
  const found = new Map(); // realpath -> path
  for (const dir of pathDirs()) {
    for (const name of names) {
      const p = path.join(dir, name);
      try {
        if (!fs.statSync(p).isFile()) continue;
      } catch {
        continue;
      }
      let key = p;
      try {
        key = fs.realpathSync(p);
      } catch {
        /* keep p */
      }
      if (!found.has(key) && looksLikeCodexShim(p)) found.set(key, p);
    }
  }
  return Array.from(found.values());
}

function kindOf(shim) {
  const l = shim.toLowerCase();
  if (l.endsWith(".cmd")) return "cmd";
  if (l.endsWith(".ps1")) return "ps1";
  return "sh";
}

function backupPath(shim) {
  const dir = path.dirname(shim);
  const kind = kindOf(shim);
  if (kind === "cmd") return path.join(dir, `${path.basename(shim, ".cmd")}.${BACKUP_TAG}.cmd`);
  if (kind === "ps1") return path.join(dir, `${path.basename(shim, ".ps1")}.${BACKUP_TAG}.ps1`);
  return path.join(dir, `${path.basename(shim)}.${BACKUP_TAG}`);
}

function assetPath(kind) {
  return path.join(__dirname, `wrapper.${kind}.asset`);
}

function isPatched(shim) {
  try {
    return fs.readFileSync(shim, "utf8").includes(MARKER);
  } catch {
    return false;
  }
}

function renderWrapper(shim) {
  const kind = kindOf(shim);
  return fs
    .readFileSync(assetPath(kind), "utf8")
    .split("__HAMSTER_BANNER_FILE__").join(bannerFile())
    .split("__HAMSTER_BACKUP__").join(backupPath(shim));
}

/* ---- ops ----------------------------------------------------------------- */

function ensureBanner(text) {
  fs.mkdirSync(hamsterDir(), { recursive: true });
  // Always (re)write: `install` with no text refreshes to the shared welcome
  // card; an explicit text argument overrides it.
  const body = (text != null ? text : DEFAULT_BANNER).replace(/\r?\n$/, "") + "\n";
  fs.writeFileSync(bannerFile(), body, "utf8");
}

function applyOne(shim) {
  if (isPatched(shim)) return { ok: true, already: true };
  const bak = backupPath(shim);
  if (!fs.existsSync(bak)) fs.copyFileSync(shim, bak);
  fs.writeFileSync(shim, renderWrapper(shim), "utf8");
  if (kindOf(shim) === "sh") {
    try {
      fs.chmodSync(shim, 0o755);
    } catch {
      /* best effort (Windows) */
    }
  }
  return { ok: true };
}

function restoreOne(shim) {
  const bak = backupPath(shim);
  if (!fs.existsSync(bak)) return { ok: true, restored: false, reason: "no backup" };
  if (!isPatched(shim)) {
    // Shim is already pristine (likely a codex self-update overwrote our
    // wrapper). Restoring the stale backup would DOWNGRADE codex — refuse and
    // just drop the now-orphaned backup.
    try {
      fs.rmSync(bak);
    } catch {
      /* ignore */
    }
    return { ok: true, restored: false, reason: "shim already pristine (backup discarded)" };
  }
  const pristine = fs.readFileSync(bak);
  fs.writeFileSync(shim, pristine);
  if (sha256(fs.readFileSync(shim)) !== sha256(pristine)) {
    return { ok: false, restored: false, reason: "sha256 mismatch after restore" };
  }
  fs.rmSync(bak);
  return { ok: true, restored: true };
}

/* ---- commands ------------------------------------------------------------ */

function cmdInstall(rest) {
  const shims = findShims();
  if (!shims.length) {
    console.log("No codex shim found on PATH. Is the Codex CLI installed (npm i -g @openai/codex)?");
    process.exit(1);
  }
  ensureBanner(rest.length ? rest.join(" ") : undefined);
  let applied = 0;
  for (const shim of shims) {
    try {
      const r = applyOne(shim);
      console.log(`  ${r.already ? "already wrapped" : "wrapped"}: ${shim}`);
      if (!r.already) applied++;
    } catch (e) {
      console.log(`  FAILED: ${shim} — ${String(e)}`);
    }
  }
  console.log(`\nBanner: ${bannerFile()}`);
  console.log(`${applied} shim(s) wrapped. Open a new \`codex\` to see it. Revert: \`node "${__filename}" uninstall\`.`);
}

function cmdUninstall() {
  const shims = findShims();
  let restored = 0;
  for (const shim of shims) {
    const r = restoreOne(shim);
    console.log(`  ${r.restored ? "restored" : "skipped (" + r.reason + ")"}: ${shim}`);
    if (r.restored) restored++;
  }
  // Sweep any orphaned backups whose shim wasn't on PATH this run.
  console.log(`\n${restored} shim(s) restored. The banner file at ${bannerFile()} is left in place.`);
}

function cmdStatus() {
  const shims = findShims();
  console.log("=== hamster codex-banner status ===");
  console.log(`banner file : ${bannerFile()}${fs.existsSync(bannerFile()) ? "" : " (none yet)"}`);
  if (!shims.length) {
    console.log("codex shims : none found on PATH");
    return;
  }
  for (const shim of shims) {
    console.log(`  ${isPatched(shim) ? "wrapped " : "pristine"} : ${shim}`);
  }
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "install":
      cmdInstall(rest);
      break;
    case "uninstall":
    case "restore":
      cmdUninstall();
      break;
    case "status":
      cmdStatus();
      break;
    default:
      console.log("hamster codex-banner — opt-in launch banner for the Codex CLI\n");
      console.log(`  node "${__filename}" install [banner text...]   wrap the codex shim(s)`);
      console.log(`  node "${__filename}" uninstall                  restore the original shim(s)`);
      console.log(`  node "${__filename}" status                     show shims + patch state`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  findShims,
  kindOf,
  backupPath,
  isPatched,
  renderWrapper,
  applyOne,
  restoreOne,
  ensureBanner,
  bannerFile,
  MARKER,
  DEFAULT_BANNER,
};
