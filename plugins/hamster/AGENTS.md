# AGENTS.md — hamster plugin

This is the user-facing product: a plugin that shows a scannable **QR "nudge"** so
the user installs a rewarded game while the agent works. The genuinely hard part
is **rendering a scannable QR across wildly different surfaces** (terminal, IDE
webview, Codex TUI). The notes below are non-obvious gotchas — most cost real
debugging to discover. Read before touching the nudge/QR or adding a surface.

## Which config belongs to which agent
- **Each runtime gets its OWN hooks file, named by its OWN manifest — and there is NO
  bare `hooks/hooks.json`.** Claude Code reads `.claude-plugin/plugin.json`
  (`"hooks": "./hooks/hooks.claude.json"`); Codex reads `.codex-plugin/plugin.json`
  (`"hooks": "./hooks/hooks.codex.json"`). Codex does **not** read `.claude-plugin/`.
  - `hooks/hooks.claude.json` wires `SessionStart(startup)` → greeting (`start-welcome.js`
    → `welcome.js`) **and** `UserPromptSubmit` → the QR nudge (`start-nudge.js` → `nudge.js`).
  - `hooks/hooks.codex.json` wires **only** `UserPromptSubmit` (byte-identical nudge block;
    a test enforces equality). It never registers `SessionStart`, so the greeting truly
    does not run on Codex — Codex fires `SessionStart` late (first prompt), where the
    `codex-banner` launch wrapper is already the welcome.
  - Both launchers provision the token if needed. `${CLAUDE_PLUGIN_ROOT}` substitution
    works in Codex too (it sets that var for compat).
- **The bare `hooks/hooks.json` MUST NOT exist — this is load-bearing.** Both runtimes
  auto-discover `hooks/hooks.json` when a manifest omits a `hooks` field. OpenAI's docs
  say a manifest `hooks` field *replaces* that auto-discovery, but we observed Codex keep
  a stale `hooks.json:session_start` registered in `~/.codex/config.toml`'s `[hooks.state]`
  after the manifest was added — so don't trust "replace" to keep a stray default out.
  Shipping NO bare `hooks/hooks.json` (each runtime points at its own explicit file via
  its manifest) keeps `SessionStart` off Codex under either behavior. `hooks/hooks.test.js`
  asserts no `hooks.json` exists.
- **Do not use sibling `bash` and `powershell` hook handlers.** Codex runs matching
  sibling command hooks independently, so Windows can report a Bash failure even
  when the PowerShell path succeeds. Use one cross-platform Node command instead.
- QR code lives in `scripts/qr/` — vendored MIT `qrcode-generator` in `vendor/`,
  **no native deps**. `nudge.js` / `welcome.js` are the brains; `launch.js` is the
  shared launcher (loads `~/.hamster/config`, provisions if needed, runs a brain),
  thinly wrapped by `start-nudge.js` and `start-welcome.js`.

## The non-contaminating channel
Hook **`systemMessage`** is shown to the user but **NOT added to the model's
context** — this is the nudge's channel, on both Claude Code and Codex. By
contrast **`additionalContext` and plain stdout DO enter context**, so never print
the QR as plain stdout; stdout must contain only the JSON hook response.

## Surface detection (Claude Code)
- `CLAUDE_CODE_ENTRYPOINT` identifies the surface: `cli` (terminal),
  `claude-vscode` (the VSCode/Cursor/Windsurf chat UI — same value for all three),
  `sdk-ts`, `mcp`, `sse-ide`. `CLAUDECODE=1` ⇒ running under Claude Code.
- Do **not** use `VSCODE_*` env vars to detect the surface — they're present even
  when the *CLI* runs inside VSCode's integrated terminal (still `entrypoint=cli`,
  where the ASCII QR works fine). Only `CLAUDE_CODE_ENTRYPOINT` distinguishes the
  rendering surface.

## Rendering gotchas, per surface
- **Claude CLI (terminal):** monospace → the Unicode/ASCII QR scans. The only
  surface where the text QR actually works.
- **Claude IDE webview (`claude-vscode`, incl. Cursor/Windsurf):** the chat is a
  react-markdown webview. It **strips `data:` image URIs** (react-markdown's
  default urlTransform allows only `http/https/mailto/…`) and **CSP blocks remote
  `https://` images** → every markdown image becomes the literal `[Image]`. A text
  QR is also unscannable here (proportional font + `<pre>` line-height inserts
  horizontal stripes). **The only way to paint a real image in this webview is an
  MCP tool returning an Anthropic `image` content block** (dedicated renderer,
  bypasses markdown) — but that result enters model context.
- **Codex TUI:** `systemMessage` renders, BUT the TUI **strips ANSI color** →
  encode the QR in **glyph shapes** (`█ ▀ ▄ space`), never fg/bg color. A
  color-encoded QR collapses to a uniform block of `▀`.

## QR scannability (cross-cutting — this bit the project hard)
- There is **no "Android QR format"** — same ISO 18004 symbology everywhere.
  Android scanners (camera + Google Lens) are simply **stricter** than iOS.
- **Inversion is the #1 trap.** A QR drawn with foreground glyphs on a dark
  terminal is *light-on-dark = inverted*. **iPhone Camera auto-flips and scans
  inverted QRs; Android usually will not.** Always render **dark-on-light** — in a
  dark terminal that means drawing the *light* modules with the glyph and leaving
  *dark* modules blank (background shows through).
- **Quiet zone ≥ 4 modules** (Android strict, iOS lenient). Keep high contrast; no
  colored or low-contrast modules.
- For image surfaces, a PNG QR needs no deps: the vendored matrix + Node's built-in
  `zlib` for the IDAT chunk.

## Codex (separate integration)
- Config lives in `~/.codex/hooks.json` or `[hooks]` in `~/.codex/config.toml`
  (hooks are **enabled by default**). Schema: `Event → matcher group → command
  handlers`. `systemMessage` (user-only) vs `additionalContext` (model context)
  split is the same as Claude.
- **`SessionStart` fires ONLY in the interactive TUI — never in `codex exec`**
  (verified, even with `--dangerously-bypass-hook-trust`). You cannot smoke-test a
  session hook headlessly; run the Node launcher directly and then verify in
  interactive `codex`.
- **`SessionStart` does NOT fire at launch on Codex — it waits for the first prompt**
  (by OpenAI's design; openai/codex#15266, closed as intended). That's why
  `hooks.codex.json` omits `SessionStart` altogether: wired, it would paint the
  greeting on the first prompt — late, and on top of the launch banner. Codex's
  welcome is the `codex-banner` launch wrapper instead (below); there is no in-hook
  way to paint anything at the moment `codex` opens.
- **Launch-banner escape hatch (opt-in):** `scripts/codex-banner/install.js` wraps
  the npm `codex`/`.cmd`/`.ps1` launcher shims OUTSIDE the hook system to print a
  banner at real launch, then exec's the backed-up original (reversible, sha256
  restore, refuses to downgrade a self-updated shim). Caveat: codex is a TUI on the
  alternate screen, so the banner shows at launch, gets covered, and reappears in
  scrollback on exit. A codex npm update regenerates the shim and silently drops the
  wrapper — re-run `install`. Pattern mirrors `growl-code-ads`'s CodexCliWrapperAdapter.
- **Hooks require trust.** The first interactive run prompts to review/trust a new
  hook; until trusted it is silently skipped. `--dangerously-bypass-hook-trust` is
  the automation escape hatch.
- **Codex CLI vs Codex DESKTOP APP — and we skip the app.** Both share `~/.codex`
  (the app writes a `[desktop]` section to `config.toml`) and load the SAME
  `hooks.codex.json`, so they can't be split by manifest. They differ only at runtime,
  by env var: the npm CLI sets `CODEX_MANAGED_BY_NPM=1`; the desktop app sets
  `CODEX_INTERNAL_ORIGINATOR_OVERRIDE="Codex Desktop"`. `launch.js`'s `isCodexDesktopApp()`
  uses the latter to no-op every hamster hook inside the desktop app (where the QR nudge
  has no good surface). Discovered by logging hook env to `~/.hamster/hook-env.log`.

## Reaching other surfaces (status, for planning)
- **Claude Desktop / Cowork:** a different product. Supports plugins — skills +
  connectors everywhere; **hooks + subagents only in Cowork**. `SessionStart`
  doesn't fire in Cowork yet. MCP there must be a **remote** connector (reached via
  Anthropic's cloud), not local stdio.
- A single **remote MCP server** returning an `image` content block (the QR) is the
  one mechanism that spans Claude Code (CLI + IDE), Desktop/Cowork, and claude.ai.

## Don't
- Don't print the QR/nudge as plain stdout — it becomes model context.
- Don't rely on ANSI color in Codex `systemMessage`, or on `data:`/remote `https://`
  images rendering in the Claude IDE webview.
- Don't split the hook into separate Bash and PowerShell handlers.
- Don't put a backend round-trip on the critical path of `UserPromptSubmit`. The QR
  fires on **every** prompt, so `nudge.js` serves the featured game from a short-TTL
  local cache (`hamster-nudge/featured.json`); only a cold/empty cache does a
  blocking fetch. Keep it that way — a per-prompt fetch would tax every prompt.
