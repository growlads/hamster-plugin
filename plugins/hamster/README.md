# 🐹 Hamster

**Win rewards while your agent codes.**

A Claude Code plugin. It greets you when your session starts, then shows a small
QR card for a live rewarded game on **every** prompt (works on **any OS**, never
blocks your prompt) — scan it with your phone, install the game, and earn real USD
as you hit in-game goals. `/wallet` shows your earnings.

The plugin never talks to any offerwall directly — it only calls the Hamster
backend, which handles all of the offer/rewards logic and partner credentials
server-side. See the [repo README](../../README.md) for the full picture.

## Commands & surfaces

| | What it does | Platforms |
| --- | --- | --- |
| **welcome** | A short "installed" greeting when your session starts. | any |
| **QR nudge** | Every prompt shows a scannable QR card for a live game (non-blocking). | any |
| **`/wallet`** | Balance, lifetime earnings, recent rewards. | any |

`/wallet` is namespaced as `/hamster:wallet`; enable a bare `/wallet` with the
[installer below](#optional-bare-commands).

> Additional play surfaces (an on-demand QR, a browser hub, and a Mac iPhone-mirroring
> flow) are built but disabled in this release — see [`disabled/`](disabled/).

## Install

**Claude Code**

```sh
claude plugin marketplace add growlads/hamster-plugin
claude plugin install hamster@hamster
```

Restart Claude Code — that's the whole setup.

**Codex**

```sh
codex plugin marketplace add growlads/hamster-plugin
codex plugin add hamster@hamster
```

Restart Codex, then **trust the hook**: when Codex shows *"Hooks need review,"* pick
**Review hooks** (or **Trust all and continue**) and enable Hamster's `UserPromptSubmit`
hook — Codex gates every plugin hook, so the QR stays off until you approve it. On Codex,
Hamster registers **only** the per-prompt QR nudge, not the `SessionStart` greeting
(Codex fires `SessionStart` too late to be useful — see the launch banner below).

Either way there's no token or config to create — the plugin connects itself on
first run (see [Connect](#connect--nothing-to-do)).

### (optional) bare commands

```sh
bash <plugin-dir>/scripts/install-bare-commands.sh        # then restart Claude Code
```

Symlinks the `wallet` skill into `~/.claude/skills/` so you get a bare `/wallet`.
It refuses to overwrite an existing non-symlink skill of the same name.

### (optional) Codex launch banner

Codex's `SessionStart` hook doesn't fire at launch (it waits for your first
prompt, by design), so the welcome can't show the instant `codex` opens. This
opt-in installer wraps the npm `codex` launcher shim to print a one-line hamster
banner at real launch — fully reversible:

```sh
node <plugin-dir>/scripts/codex-banner/install.js install     # wrap the codex shim(s)
node <plugin-dir>/scripts/codex-banner/install.js status      # show shims + state
node <plugin-dir>/scripts/codex-banner/install.js uninstall   # restore the originals
```

Pass your own text: `… install "  🐹 hamster · play — play & earn while I code"`.
It only touches the `codex` / `codex.cmd` / `codex.ps1` shims, backs each up, and
restores byte-exact. Note: codex is a TUI, so the banner shows at launch then is
covered by the UI and reappears in your terminal scrollback after you quit codex.
A codex update (npm) regenerates the shim and drops the wrapper — just re-run
`install`.

## Connect — nothing to do

There's no setup step. On first run the plugin mints your per-user token and
saves it (with the backend URL) to `~/.hamster/config`. It's automatic,
one-time, and silent — just install, restart, and start sending prompts.

> Needs **Node.js ≥ 18** on your `PATH` (the same requirement as the QR). If Node
> is missing, connecting is skipped silently and retried next time.

### Development / overrides

`~/.hamster/config` is a plain `KEY=value` file; the env vars `HAMSTER_API_URL`
and `HAMSTER_TOKEN` override it, which overrides the shipped default
(`hamster.defaults` → `https://hamster.win`). To point at a local backend:

```sh
export HAMSTER_API_URL="http://localhost:8787"
```

See [`.hamster.config.example`](../../.hamster.config.example) for the file format.

## Requirements

- **For the nudge QR** — **Node.js ≥ 18** on your `PATH` (the QR is rendered by a
  small Node script) and a **phone to scan**. Works on macOS, Windows, and Linux.
  If Node is missing, the nudge stays silent rather than disrupting your prompt.
- **To actually earn** — your **phone must be in a supported region**:
  **US · CA · GB · DE · FR · IT · ES · AU**. The phone's IP is checked at scan
  time; outside those regions you'll hit a "Games Unavailable" page (a VPN on the
  phone resolves it). This is the most common "why isn't it working?" — it's
  geography, not a bug.

## Usage

- Just **send a prompt** — the nudge shows a QR card on every one. Scan it with
  your phone's camera, install the game, and play while Claude works.
- **`/wallet`** (or `/hamster:wallet`) — balance, lifetime, recent rewards.

## Troubleshooting

- **QR scan says "Games Unavailable."** You're (or your phone is) outside a
  supported region — see Requirements. Turn on a VPN on the phone in a supported
  region and rescan.
- **No QR card appears.** The nudge renders in Node and fails soft — install
  **Node.js ≥ 18** and make sure `node` is on your `PATH` (it's also what mints
  your token automatically).
- **`/wallet` says it "couldn't connect automatically."** Auto-connect needs
  **Node.js ≥ 18** and a reachable backend. Install Node and retry, or set
  `HAMSTER_TOKEN` in `~/.hamster/config` yourself (see **Connect**).
