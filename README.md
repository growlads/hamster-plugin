# 🐹 Hamster

**Win rewards while your agent codes.**

Hamster is a [Claude Code](https://claude.com/claude-code) plugin. While Claude
works a long task, scan a QR code, install a rewarded game on your phone, and earn
**real USD** as you hit in-game goals. `/wallet` shows what you've made — keep
coding, your phone earns on the side.

---

## Install

**Claude Code**

```bash
claude plugin marketplace add growlads/hamster
claude plugin install hamster@hamster
```

Restart Claude Code — that's the whole setup.

**Codex**

```bash
codex plugin marketplace add growlads/hamster
codex plugin add hamster@hamster
```

Restart Codex, then **trust the hook**: Codex shows *"Hooks need review."* Pick
**Review hooks** (or **Trust all and continue**) and turn on Hamster's `UserPromptSubmit`
hook — the QR can't run until it's trusted. (Codex gates every plugin hook this way.) On
Codex, Hamster registers **only** the per-prompt QR nudge, not the `SessionStart`
greeting — Codex fires `SessionStart` too late to be useful (see the launch banner below).

---

**No token, API key, or config to set up** — Hamster connects itself on first run
(it mints and stores your per-user token automatically). When your next session
starts, a QR card appears: scan it with your phone, install the game, and check
**`/wallet`** for earnings.

> Only requirement: **Node.js ≥ 18** on your `PATH` (check with `node --version`).
> Without it nothing breaks — you just won't see the QR until Node is installed.

---

## What you get

| Command | What it does | Works on |
| --- | --- | --- |
| **welcome** | A short "installed" greeting when a session **starts**. | macOS · Windows · Linux |
| **QR nudge** | On **every** prompt, shows a small, scannable QR card for a live game so you can start earning right away. Never blocks you. | macOS · Windows · Linux |
| **`/wallet`** | Your balance, lifetime earnings, and recent rewards. | any |

`/wallet` is namespaced as `/hamster:wallet`; you can also enable a bare `/wallet` —
see [bare commands](#optional-bare-commands).

> Additional play surfaces (an on-demand `/qr`, a browser `/hub`, and a Mac
> iPhone-mirroring `/play` flow) are built but disabled in this release. The code
> lives under [`plugins/hamster/disabled/`](plugins/hamster/disabled/) — see its
> README to re-enable.

> **Codex extra (opt-in):** Codex fires `SessionStart` on your first prompt, not at
> launch, so the welcome can't show the instant `codex` opens. An opt-in installer
> (`scripts/codex-banner/`) wraps the `codex` launcher to print the same welcome
> card at real launch — fully reversible. See the [plugin README](plugins/hamster/README.md#optional-codex-launch-banner).

<details>
<summary>Advanced — point at a different backend (development only)</summary>

You never need this for normal use: the backend URL defaults to `https://hamster.win`
(shipped in `hamster.defaults`). `~/.hamster/config` is a plain `KEY=value` file;
precedence is **env var → `~/.hamster/config` → shipped default**. To run against a
local backend:

```bash
export HAMSTER_API_URL="http://localhost:8787"
```

See [`.hamster.config.example`](.hamster.config.example) for the file format.
</details>

## (optional) bare commands

`/wallet` is namespaced (`/hamster:wallet`). To also get a bare `/wallet`:

```bash
bash plugins/hamster/scripts/install-bare-commands.sh   # then restart Claude Code
```

---

## Requirements

| For | You need |
| --- | --- |
| The session nudge QR | **Node.js ≥ 18** on your `PATH` (the QR is rendered by a small Node script) and a **phone to scan** |
| Actually earning | a **phone in a supported region** — see [region note](#-region-note) |

> Check Node with `node --version`. If it's missing, the nudge fails soft (it stays
> silent rather than disrupting your prompt) — install Node and retry.

### 🌍 Region note

Rewarded offers are served only in: **US · CA · GB · DE · FR · IT · ES · AU**.

The country that matters is **where your phone is** — it's checked at the phone's IP
when you scan. If your phone is outside a supported region you'll land on a "Games
Unavailable" page even though everything else is correct; a **VPN on the phone** set
to a supported region resolves it. This is the single most common "why doesn't it
work?" — it's geography, not a bug.

---

## Troubleshooting

- **QR scan says "Games Unavailable."** Your phone is outside a supported region —
  see the region note. Turn on a VPN on the phone and rescan.
- **No QR card appears.** The nudge renders in Node and fails soft — install
  **Node.js ≥ 18** and make sure `node` is on your `PATH` (it also mints your
  token automatically on first run).
- **`/wallet` says it "couldn't connect automatically."** Auto-connect needs
  **Node.js ≥ 18** and a reachable backend — install Node and retry, or set
  `HAMSTER_TOKEN` in `~/.hamster/config` yourself (see [Install](#install)).

---

## Repo layout

This repo is the **plugin** only — it talks to the backend purely over HTTP, so the
two ship independently.

```
.claude-plugin/marketplace.json   # the "hamster" marketplace (install entry point)
plugins/hamster/                  # the Claude Code plugin (this is the public product)
  ├─ skills/wallet                 #   /wallet
  ├─ hooks/hooks.claude.json      #   Claude Code: SessionStart greeting + UserPromptSubmit nudge
  ├─ hooks/hooks.codex.json       #   Codex: UserPromptSubmit nudge only (Codex SessionStart fires too late)
  ├─ hamster.defaults             #   shipped default backend URL (overridable)
  ├─ scripts/provision.js         #   self-provisioning: mint + store the token
  ├─ scripts/qr/                  #   QR renderer + session-nudge brain (Node, no native deps)
  └─ disabled/                    #   built-but-off surfaces (/qr, /hub, /play) — see its README
.hamster.config.example           # ~/.hamster/config template (optional; auto-generated)
ARCHITECTURE.md                   # how the plugin, backend, and Besitos fit together
```

> **Backend operators:** the backend (the Cloudflare Worker behind `hamster.win`) lives
> in the sibling `hamster-play/` repo and has its own setup, deploy, and operations
> docs in [backend/README.md](../README.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
