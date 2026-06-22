#!/usr/bin/env node
/*
 * dev-reinstall.js — re-snapshot the hamster plugin into Claude Code and/or Codex
 * from THIS source repo, in one command.
 *
 * Why this exists: neither runtime runs the plugin from the working tree — both
 * COPY ("snapshot") it into a cache at install/add time, so source edits are not
 * live until you re-snapshot. On top of that the marketplace pointer drifts (it
 * can end up aimed at github or at the sibling `growlads/hamster` clone), and the
 * Codex launch banner is a separate snapshot of the welcome copy. This script
 * pins the `hamster` marketplace at this repo, re-snapshots the plugin in each
 * runtime, and refreshes the Codex banner if it's installed. See
 * plugins/hamster/AGENTS.md → "Developing locally: snapshot model".
 *
 * Usage:
 *   node dev-reinstall.js                 # both runtimes (skips any not installed)
 *   node dev-reinstall.js claude          # Claude Code only
 *   node dev-reinstall.js codex           # Codex only
 *   node dev-reinstall.js --no-banner     # skip the Codex banner refresh
 *   node dev-reinstall.js uninstall       # remove the plugin + marketplace from both
 *   node dev-reinstall.js uninstall codex # uninstall from one runtime
 *   node dev-reinstall.js uninstall --banner  # also remove the Codex launch banner
 *   node dev-reinstall.js -h | --help
 *
 * Idempotent and safe to re-run. Changes apply on the NEXT session, not the one
 * already running; Codex also gates hooks on trust (review/trust on next launch).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// scripts/ -> plugins/hamster/ -> plugins/ -> <repo root>
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MARKETPLACE_JSON = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_SRC = path.join(REPO_ROOT, "plugins", "hamster");
const BANNER_INSTALLER = path.join(__dirname, "codex-banner", "install.js");

function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** Run a shell command. Returns { code, stdout }. Throws/exits on failure unless allowFail. */
function run(cmd, { allowFail = false, capture = false, label } = {}) {
  if (label) console.log(`  $ ${label}`);
  const res = spawnSync(cmd, {
    shell: true,
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const code = res.status == null ? 1 : res.status;
  if (capture && !label) {
    // quiet probe
  }
  if (code !== 0 && !allowFail) {
    die(`command failed (exit ${code}): ${cmd}`);
  }
  return { code, stdout: res.stdout || "" };
}

/** Is a CLI on PATH and runnable? */
function cliAvailable(bin) {
  const res = spawnSync(`${bin} --version`, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return res.status === 0;
}

function header(title) {
  console.log(`\n=== ${title} ===`);
}

function reinstallClaude() {
  header("Claude Code");
  if (!cliAvailable("claude")) {
    console.log("  – `claude` not found on PATH — skipping.");
    return { runtime: "claude", status: "skipped" };
  }
  // Pin the `hamster` marketplace at this repo (remove any stale pointer first).
  // Use a relative "./" — claude (>=2.0.76) rejects absolute Windows paths for
  // `marketplace add` ("Try: owner/repo, https://..., or ./path"). run() sets
  // cwd to REPO_ROOT, so "./" resolves to this repo.
  run("claude plugin marketplace remove hamster", { allowFail: true, label: "claude plugin marketplace remove hamster" });
  run("claude plugin marketplace add ./", { label: "claude plugin marketplace add ./ (cwd = repo root)" });
  // Re-snapshot the plugin.
  run("claude plugin uninstall hamster", { allowFail: true, label: "claude plugin uninstall hamster" });
  run("claude plugin install hamster@hamster", { label: "claude plugin install hamster@hamster" });
  console.log("  ✓ Claude: re-snapshotted from this repo.");
  return { runtime: "claude", status: "ok" };
}

function refreshCodexBanner() {
  if (!fs.existsSync(BANNER_INSTALLER)) return;
  // The banner is a separate snapshot of the welcome copy (an opt-in wrapper around
  // the codex launcher shim), so a plugin re-snapshot alone never updates it. We:
  //   - refresh it if it's currently wrapped;
  //   - RESTORE it if the shim is pristine but an orphaned hamster backup is sitting
  //     next to it — that means a `codex` npm self-update regenerated the shim and
  //     silently dropped a wrapper the user had installed (a documented caveat);
  //   - otherwise leave it alone — never auto-opt-in a user who never wrapped a shim.
  let banner;
  try {
    banner = require(BANNER_INSTALLER);
  } catch (e) {
    console.log(`  banner: couldn't load codex-banner installer (${e.message}) — skipping`);
    return;
  }
  let shims = [];
  try {
    shims = banner.findShims();
  } catch {
    /* none */
  }
  if (!shims.length) {
    console.log("  banner: no codex shim on PATH — skipping");
    return;
  }
  const wrapped = shims.filter((s) => banner.isPatched(s));
  const orphaned = shims.filter((s) => !banner.isPatched(s) && fs.existsSync(banner.backupPath(s)));
  if (wrapped.length) {
    console.log("  banner is installed → refreshing welcome copy");
    run(`node "${BANNER_INSTALLER}" install`, { allowFail: true, label: "codex-banner install (refresh)" });
  } else if (orphaned.length) {
    console.log("  banner wrapper was dropped by a codex shim self-update → restoring");
    run(`node "${BANNER_INSTALLER}" uninstall`, { allowFail: true, label: "codex-banner uninstall (clear stale backups)" });
    run(`node "${BANNER_INSTALLER}" install`, { allowFail: true, label: "codex-banner install (re-wrap current shims)" });
  } else {
    console.log("  banner not installed → skipping (opt in with: node scripts/codex-banner/install.js install)");
  }
}

function reinstallCodex({ banner = true } = {}) {
  header("Codex");
  if (!cliAvailable("codex")) {
    console.log("  – `codex` not found on PATH — skipping.");
    return { runtime: "codex", status: "skipped" };
  }
  run("codex plugin remove hamster@hamster", { allowFail: true, label: "codex plugin remove hamster@hamster" });
  run("codex plugin marketplace remove hamster", { allowFail: true, label: "codex plugin marketplace remove hamster" });
  run(`codex plugin marketplace add "${REPO_ROOT}"`, { label: `codex plugin marketplace add "${REPO_ROOT}"` });
  run("codex plugin add hamster@hamster", { label: "codex plugin add hamster@hamster" });
  console.log("  ✓ Codex: re-snapshotted from this repo.");
  if (banner) refreshCodexBanner();
  return { runtime: "codex", status: "ok" };
}

function uninstallClaude() {
  header("Claude Code (uninstall)");
  if (!cliAvailable("claude")) {
    console.log("  – `claude` not found on PATH — skipping.");
    return { runtime: "claude", status: "skipped" };
  }
  run("claude plugin uninstall hamster", { allowFail: true, label: "claude plugin uninstall hamster" });
  run("claude plugin marketplace remove hamster", { allowFail: true, label: "claude plugin marketplace remove hamster" });
  console.log("  ✓ Claude: plugin + marketplace removed.");
  return { runtime: "claude", status: "ok" };
}

function uninstallCodex({ banner = false } = {}) {
  header("Codex (uninstall)");
  if (!cliAvailable("codex")) {
    console.log("  – `codex` not found on PATH — skipping.");
    return { runtime: "codex", status: "skipped" };
  }
  run("codex plugin remove hamster@hamster", { allowFail: true, label: "codex plugin remove hamster@hamster" });
  run("codex plugin marketplace remove hamster", { allowFail: true, label: "codex plugin marketplace remove hamster" });
  // The launch banner is a separate shim wrapper, so plugin removal never touches it.
  // Only remove it when explicitly asked (--banner), since the user opted into it.
  if (banner && fs.existsSync(BANNER_INSTALLER)) {
    run(`node "${BANNER_INSTALLER}" uninstall`, { allowFail: true, label: "codex-banner uninstall" });
  }
  console.log("  ✓ Codex: plugin + marketplace removed." + (banner ? " (banner too)" : ""));
  return { runtime: "codex", status: "ok" };
}

function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    const src = fs.readFileSync(__filename, "utf8");
    const doc = src.slice(src.indexOf("/*") + 2, src.indexOf("*/"));
    console.log(doc.replace(/^ \* ?/gm, "").trim());
    return;
  }

  // Guard: must run from the real source repo, not a flattened cache snapshot.
  if (!fs.existsSync(MARKETPLACE_JSON) || !fs.existsSync(PLUGIN_SRC)) {
    die(
      `not in the hamster-plugin source repo.\n  expected ${MARKETPLACE_JSON}\n` +
        "  Run this from a checkout of growlads/hamster-plugin (not the plugin cache)."
    );
  }

  const uninstall = argv.includes("uninstall");
  const wantBanner = uninstall ? argv.includes("--banner") : !argv.includes("--no-banner");
  const targets = argv.filter((a) => a === "claude" || a === "codex");
  const doClaude = targets.length === 0 || targets.includes("claude");
  const doCodex = targets.length === 0 || targets.includes("codex");

  const results = [];
  if (uninstall) {
    console.log("Uninstalling hamster from the selected runtime(s).");
    if (doClaude) results.push(uninstallClaude());
    if (doCodex) results.push(uninstallCodex({ banner: wantBanner }));
  } else {
    console.log(`Re-snapshotting hamster from: ${REPO_ROOT}`);
    if (doClaude) results.push(reinstallClaude());
    if (doCodex) results.push(reinstallCodex({ banner: wantBanner }));
  }

  header("Done");
  for (const r of results) console.log(`  ${r.runtime}: ${r.status}`);
  console.log("\nReminders:");
  console.log("  • Changes apply on the NEXT session — restart the CLI(s).");
  if (!uninstall) {
    console.log('  • Codex gates hooks on trust: the next interactive `codex` shows');
    console.log('    "Hooks need review" — pick Review/Trust, or hamster\'s hooks are skipped.');
  }

  if (results.some((r) => r.status === "skipped") && !results.some((r) => r.status === "ok")) {
    die("no runtime was reinstalled (neither `claude` nor `codex` found).");
  }
}

main(process.argv.slice(2));
