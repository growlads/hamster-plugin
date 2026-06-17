"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Fake codex shims live in a temp "bin" on PATH; HAMSTER_HOME is redirected so
// the suite never touches the real codex install or ~/.hamster.
let tmp, binDir, origPath, origHome;
let mod;

const SHIM_BODY = "#!/bin/sh\n# pretend @openai/codex launcher\nexec node codex.js \"$@\"\n";

function shimNames() {
  return process.platform === "win32" ? ["codex.cmd", "codex.ps1", "codex"] : ["codex"];
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hamster-cbanner-"));
  binDir = path.join(tmp, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const n of shimNames()) fs.writeFileSync(path.join(binDir, n), SHIM_BODY);

  origPath = process.env.PATH;
  origHome = process.env.HAMSTER_HOME;
  process.env.PATH = binDir + (process.platform === "win32" ? ";" : ":") + (origPath || "");
  process.env.HAMSTER_HOME = path.join(tmp, "home");

  mod = require("./install.js");
});

after(() => {
  process.env.PATH = origPath;
  if (origHome === undefined) delete process.env.HAMSTER_HOME;
  else process.env.HAMSTER_HOME = origHome;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

test("findShims discovers the fake codex shim(s) on PATH", () => {
  const shims = mod.findShims();
  for (const n of shimNames()) {
    assert.ok(shims.some((s) => path.basename(s) === n), `found ${n}`);
  }
});

test("ensureBanner writes a default, and a custom line when given", () => {
  mod.ensureBanner(undefined);
  assert.match(fs.readFileSync(mod.bannerFile(), "utf8"), /hamster/);
  mod.ensureBanner("custom line");
  assert.equal(fs.readFileSync(mod.bannerFile(), "utf8"), "custom line\n");
});

test("applyOne wraps the shim: backup made, marker + paths embedded, idempotent", () => {
  const shim = path.join(binDir, shimNames()[0]);
  const original = fs.readFileSync(shim);

  const r1 = mod.applyOne(shim);
  assert.equal(r1.ok, true);
  assert.equal(r1.already, undefined);

  const bak = mod.backupPath(shim);
  assert.ok(fs.existsSync(bak), "backup created");
  assert.deepEqual(fs.readFileSync(bak), original, "backup is byte-exact original");

  const wrapped = fs.readFileSync(shim, "utf8");
  assert.ok(wrapped.includes(mod.MARKER), "marker present");
  assert.ok(wrapped.includes(mod.bannerFile()), "banner path substituted");
  assert.ok(wrapped.includes(bak), "backup path substituted");
  assert.ok(mod.isPatched(shim));

  const r2 = mod.applyOne(shim);
  assert.equal(r2.already, true, "second apply is a no-op");
});

test("restoreOne restores byte-exact and removes the backup", () => {
  const shim = path.join(binDir, shimNames()[0]);
  const r = mod.restoreOne(shim);
  assert.equal(r.ok, true);
  assert.equal(r.restored, true);
  assert.equal(fs.readFileSync(shim, "utf8"), SHIM_BODY, "shim back to original bytes");
  assert.ok(!fs.existsSync(mod.backupPath(shim)), "backup removed");
  assert.equal(mod.isPatched(shim), false);
});

test("stale-backup guard: refuses to downgrade a self-updated shim", () => {
  const shim = path.join(binDir, shimNames()[0]);
  mod.applyOne(shim); // backup = old SHIM_BODY

  // Simulate `npm i -g @openai/codex` regenerating the shim (new pristine,
  // unpatched) on top of our wrapper.
  const updated = SHIM_BODY.replace("pretend", "pretend NEWER @openai/codex");
  fs.writeFileSync(shim, updated);

  const r = mod.restoreOne(shim);
  assert.equal(r.restored, false, "did not restore");
  assert.match(r.reason, /pristine/);
  assert.equal(fs.readFileSync(shim, "utf8"), updated, "newer shim left intact (no downgrade)");
  assert.ok(!fs.existsSync(mod.backupPath(shim)), "orphaned backup discarded");
});
