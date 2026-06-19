# Architecture

Hamster is three parts:

- **Plugin** (Claude Code) — hooks, commands, and skills. Talks **only** to our backend with a per-user bearer token. Renders QR codes locally in Node (vendored, no native deps). Never sees Besitos credentials, raw payouts, or other users' data.
- **Backend** (Cloudflare Worker + D1) — the only thing that talks to Besitos. Mints user tokens, fetches live offers, serves the monitored `/go` redirect the QR points at, receives reward postbacks, and keeps the USD ledger.
- **Besitos** ([wall.besitos.ai](https://help.besitoscorp.com)) — the offerwall. Reached server-to-server only.

```
                                   per-user bearer token
 Claude Code plugin  ───────────────────────────────────────▶  backend (CF Worker)
   • welcome      (SessionStart)                                 /v1/register
   • session nudge (UserPromptSubmit, every prompt)              /v1/featured · /v1/games[/next]
   • /wallet                                                     /v1/sessions · /v1/stats · /v1/hub
   • /qr   (UserPromptExpansion)  — disabled                     /go/<id>     (public scan redirect)
   • /hub  (UserPromptExpansion)  — disabled                     /app         (browser hub)
   • /play (slash-only, macOS)    — disabled                     /webhooks/besitos (HMAC postback)
                                                                 scheduled() daily reconcile
        ▲
        │ QR / nudge card                                             │   ▲
        │                                                  s2s (Bearer │   │ HMAC-SHA256
   phone scans ──▶ GET /go/<id> ──▶ 302 ──▶ Besitos ──▶ App/Play Store │   │ postbacks
                                                          wall.besitos.ai ──┘ (conversions)
                                                                 │
                                                          D1: users · sessions · conversions · links
```

---

## Release surface

This release ships only the **session nudge** and **`/wallet`**. The on-demand
**`/qr`**, the browser **`/hub`**, and the Mac iPhone-mirroring **`/play`** flow are
built but disabled — their definitions and feature-only scripts live under
`plugins/hamster/disabled/` (see its README to re-enable). The backend still exposes
all of the endpoints they use, so re-enabling is a plugin-side move-back, not a
backend change. The sections below document the full design, disabled surfaces
included.

---

## Installing the plugin locally (development)

Both Claude Code and Codex **snapshot** the plugin — they copy it into a local cache
at install time rather than running it from the source tree — so local edits are not
live: **re-snapshot after every change and start a new session** (neither runtime
applies changes to the session already running). The snapshot copies the entire
working tree, **including uncommitted and untracked files**, so you can test local
changes without committing.

Install from **this repo** (`growlads/hamster-plugin`), not the older sibling
`growlads/hamster` clone. The marketplace name is `hamster`, so the plugin is
`hamster@hamster`. **`node plugins/hamster/scripts/dev-reinstall.js`** automates all
of the steps below for both runtimes (idempotent); the manual flow is:

- **Point the marketplace at this directory** once per runtime (remove a stale
  `hamster` marketplace first if one points at github or the old clone):
  `claude plugin marketplace add <hamster-plugin path>` /
  `codex plugin marketplace add <hamster-plugin path>`.
- **Re-snapshot after edits:** `claude plugin uninstall hamster && claude plugin
  install hamster@hamster`; `codex plugin remove hamster@hamster && codex plugin add
  hamster@hamster`.
- **Codex gates hooks on trust** — the next interactive `codex` prompts to
  review/trust the hooks, else they're silently skipped.

Caches (plugin contents flattened to the cache root):
`~/.claude/plugins/cache/hamster/hamster/<version>/` and
`~/.codex/plugins/cache/hamster/hamster/local/`. The `codex-banner` launch wrapper is
**outside** the plugin system, so a plugin uninstall doesn't remove it — see
`scripts/codex-banner/install.js`.

**Welcome copy is single-sourced — refresh the Codex banner after editing it.** The
greeting text lives once in `scripts/qr/welcome-card.js` (`buildWelcome()`): Claude's
`welcome.js` renders it live, while the Codex launch banner snapshots it into
`~/.hamster/codex-banner.txt` at install time (only the `agent` name in the value line
differs per surface). Edit copy in `welcome-card.js` only — but because the banner is a
snapshot outside the plugin, a plugin re-snapshot won't update it: re-run
`node scripts/codex-banner/install.js install` to refresh an installed banner.

---

## Two ways to play

### A. QR / nudge — cross-platform, the default path

No Mac required; works on macOS, Windows, and Linux.

1. **A hook fires.** The **session nudge** (`UserPromptSubmit`, on **every** prompt) or **`/qr`** on demand (`UserPromptExpansion`). Both run a small Node script under `scripts/qr/`. (Separately, `SessionStart` shows a one-time **welcome** card — no QR.)
2. **Plugin → `GET /v1/featured`** (bearer). The backend reads the request's **country** from Cloudflare's edge geo, fetches the user's **live, in-region** offers (Besitos *Games User Data API*), picks one, mints a `/go/<link_id>` row, and returns `{ title, reward_usd_total, go_url }`. The nudge serves this from a short-TTL local cache (~2 min), so only a cold/empty cache makes the call — every other prompt renders instantly.
3. **Plugin renders a QR** of the `go_url` plus a named card (game title + reward). The QR is drawn from Node with a generous fetch timeout, so a slow/cold backend can never hang the prompt — on failure the nudge just stays silent.
4. **Phone scans → `GET /go/<link_id>`.** The backend detects the **scanning device's** platform (User-Agent) and country (edge geo), **re-resolves a currently-live offer for that exact `(country, platform)`**, and `302`s to the Besitos tracking URL (with our `partner_user_id`), which forwards to the App Store / Play Store. The click is logged and a session recorded.
5. **Install & play.** Besitos fires goal-completion postbacks → the ledger credits `payout × REWARD_SHARE`. `/wallet` shows the balance. On the **next** prompt after rewards land, the nudge leads with a one-time `+$X earned while you coded` topper (see below), then the QR.

The QR always encodes **our** `/go/<id>`, never a raw Besitos link. That indirection is what lets the offer be **resolved at scan time** — so it's always current and correct for the device/region that actually scanned, even if the QR was generated minutes earlier.

### B. `/play` — Mac iPhone Mirroring

The Mac-native power path (slash-only). Requires macOS 15+ and iPhone Mirroring (see README).

1. `preflight.sh` — macOS 15+, iPhone Mirroring app present, token configured.
2. `next-game.sh` — `GET /v1/games/next` → a random fresh live offer (deprioritizing ones the user already started/earned), then `POST /v1/sessions` to record intent and get the `click_url` + `go_url`.
3. `mirror-open.sh` — launches iPhone Mirroring and drives the phone by keystroke (`Cmd+1` Home → `Cmd+3` Spotlight → Safari → `Cmd+L` → **paste** the URL). The URL is copied to the Mac clipboard and synced to the phone via **Universal Clipboard**, then pasted whole — typing a ~95-char URL drops characters and corrupts the click id / `partner_user_id`, which breaks attribution. The click lands **on the device**, so Besitos opens the App Store page on the phone with attribution intact. Any failure falls back to printing the URL (+ a QR if `qrencode` exists).
4. Install, play, earn — same postback/ledger path as above.

---

## The Besitos integration

- **Source — Games *User Data* API:** `GET /data/{partner_id}/{user_id}?device_platform=<ios|android>&country=<ISO2>`. Returns **only offers the user currently qualifies for** — Besitos has already dropped expired, budget-exhausted, and completed offers. This is why a scan can't land on a dead offer. (`../src/besitos.ts → fetchUserOffers`.)
- **Fallback — Games catalog:** on any upstream error, we fall back to the user-agnostic catalog `GET /data/partner/offers/{partner_id}` filtered to `budget_status=Active` (no worse than the pre-User-Data behavior). The fallback is logged so we can spot it.
- **Caching** (per Worker isolate): ~2 min per `(user, platform, country)` for the user-data list; ~5 min per `(platform, country)` for the catalog. So a cold `/v1/featured` can take ~1–2s (the upstream call) and is fast for ~2 min after.
- **Country** comes from `request.cf.country` (Cloudflare edge geo), with a `?country=` override for testing, defaulting to `US` only when geo is unavailable (e.g. local `wrangler dev`).
- **Scan-time resolution** (`../src/links.ts → resolveTarget`): for the scanning device's `(country, platform)`, prefer the offer the QR named (matched by id same-platform, by title cross-platform); else serve any currently-live offer for that combo; only if the combo has none do we replay the stored URL. This closes the expiry / region / device-mismatch window.
- **Click URL binding:** the offer's `url` ships with an empty `?partner_user_id=`; `buildClickUrl` *sets* it to our `user_id`. The `partner_id` is baked into the redirect path by Besitos.
- **Auth quirk:** Besitos' live API requires the **capitalized `Bearer`** header (their docs say lowercase, which returns 401). Verified 2026-06-11.
- **Observability:** each upstream User Data API call logs status, latency, and offer count (partner id redacted) for monitoring the live integration.

### Region lock

Besitos serves offers only in **US · CA · GB · DE · FR · IT · ES · AU**. The country that ultimately gates serving is the **phone's IP at scan time** — our `country` param only chooses which catalog we *show*. A phone outside a supported region lands on Besitos' "Games Unavailable" page regardless of our targeting; a VPN on the phone resolves it. This is geography, not a bug — see the README's region note.

### Inventory scope

We integrate **Games only** (the Games User Data API). Besitos' catalog also includes **Surveys**, **Deals** (Deals / Deals User Data API), **Games International**, **User Profiling**, and the **Conversion Data** API. Each follows the same per-user "available list + redirect URL" shape, so adding surveys/deals later is additive — fold them into the offer pool and render them through the same QR/`/go` machinery — not a rework.

---

## Payout model

Our USD payout per install is the **offer-level `cpi`**; goals carry only a user-facing `amount` (display-currency weight), **not** USD. So:

- `reward_usd_total = cpi × REWARD_SHARE`
- per-goal `reward_usd` = that total split proportionally by goal `amount` (a goal with `amount: 0`, e.g. the install step, shows `$0` — faithful to the data)

The pre-play figure is a **max-earnable estimate**; the authoritative per-conversion USD is whatever Besitos sends in the postback `payout`. We never expose `cpi`/our payout to the plugin — only the user's share. USD is rounded to cents at write time; balance is `SUM(amount_usd)` with reversals stored negative.

---

## Data model (D1)

| Table | Purpose |
| --- | --- |
| `users` | `user_id` (= Besitos `partner_user_id`), 256-bit bearer `token`, `created_at` |
| `sessions` | one row when a user starts/scans an offer — powers "in play" + variety rotation |
| `conversions` | one row per Besitos `transaction_id`; clawbacks are separate `reversed=1` rows with negative `amount_usd`, so `balance = SUM(amount_usd)` |
| `links` | the `/go/<link_id>` capability: `(user_id, offer_id, offer_title, device, click_url)` + click monitoring (`click_count`, `last_click_at`, `last_platform`, `last_ua`) |

---

## Trust boundaries

- **Plugin ↔ backend:** per-user 256-bit bearer token (minted by `/v1/register`, constant-time compared). The plugin never sees Besitos credentials, raw `cpi`/`payout`, or other users' data.
- **Backend ↔ Besitos:** `BESITOS_API_TOKEN` + `BESITOS_PARTNER_ID` secrets, server-to-server only. Our `user_id` (`u_<hex>`, ≤50 chars, `[a-zA-Z0-9_-]`) is the Besitos `partner_user_id`.
- **Besitos → webhook:** HMAC-SHA256 `verifier` over the received URL minus the verifier param, constant-time compared against `BESITOS_WEBHOOK_SECRET`; dedup on `transaction_id` (race-safe `ON CONFLICT DO NOTHING`); `reverse=1` → negative clawback row. An IP allowlist (arranged with the account manager) can harden it further.
- **`/go/<id>` & `/app`:** no auth — the id in the path is the capability. Its only power is "trigger a redirect attributed to this user," so it's safe in a QR; the bearer token never leaves the config file.

---

## Design decisions

- **`/play` is slash-only** (`disable-model-invocation: true`) — launching apps and typing into a phone is a side effect Claude shouldn't auto-trigger. `/qr`, `/hub` are also slash hooks; `/wallet` is auto-triggerable ("how much have I made?" just works). (`/qr`, `/hub`, `/play` are disabled in this release — see **Release surface**.)
- **Earnings summary rides the nudge at zero added latency.** When a reward postback has credited the user since they last saw one, the next nudge leads with a tasteful one-time `+$X earned while you coded · N rewards cleared` topper above the QR. The nudge fetches `GET /v1/earnings` **in parallel** with `/v1/featured`, so the (tiny, Besitos-free) ledger read overlaps the slow offer fetch and adds no wall-clock. The "mark read" lives entirely server-side: `/v1/earnings` *claims-and-marks-read* in one call (advances a per-user cursor over `conversions.rowid`), so each reward shows exactly once with no client bookkeeping, and a brand-new install is baselined silently rather than retro-dumped. Both halves fail soft and independently — just earnings, just the card, both, or (unconfigured/unreachable) nothing.
- **The session nudge never blocks.** It rides in `systemMessage` (shown without `decision:block`); a slow/unreachable backend, missing token, or missing Node just yields no card — the prompt always proceeds. Because it fires on **every** prompt, the featured game is served from a short-TTL local cache so only a cold cache adds a backend round-trip; warm prompts render with no network at all.
- **Codex launch banner is an opt-in shim wrap, not a hook.** Codex fires `SessionStart` on the *first prompt*, not at launch (OpenAI's design, [openai/codex#15266](https://github.com/openai/codex/issues/15266)), so the welcome can't paint when `codex` opens. `scripts/codex-banner/` *optionally* wraps the npm `codex`/`.cmd`/`.ps1` launcher shims — printing the same welcome card at real launch, then `exec`'ing the pristine original. Reversible (sha256-verified restore that refuses to downgrade a self-updated shim), needs no server, and shares its card text with the hook (`scripts/qr/welcome-card.js`). Caveat: codex is a TUI, so the banner is a launch flash + post-quit scrollback line, not a persistent header.
- **Per-runtime hooks — the welcome is Claude-Code-only by construction.** We want the greeting at session open; Codex fires `SessionStart` on the *first prompt*, not at launch, so on Codex it would arrive late and on top of the launch banner. So each runtime loads its **own** hooks file via its **own** manifest, and there is **no bare `hooks/hooks.json`** for either runtime to auto-discover: `.claude-plugin/plugin.json → hooks/hooks.claude.json` (`SessionStart` greeting + `UserPromptSubmit` nudge) and `.codex-plugin/plugin.json → hooks/hooks.codex.json` (the `UserPromptSubmit` nudge **only**). The per-prompt nudge runs on both runtimes; the greeting runs only on Claude Code. Subtlety: Codex's manifest `hooks` field is *documented* to replace the auto-discovered default, but we observed a stale auto-discovered `hooks.json` SessionStart linger in `~/.codex`'s hook-trust state — so shipping **no** default file is what makes the split hold under either behavior. `hooks/hooks.test.js` asserts the bare file's absence.
- **No hamster hook runs in the Codex *desktop app*.** The desktop app and the npm CLI share `~/.codex` and load the same `hooks.codex.json`, so they can't be separated by manifest — instead `scripts/qr/launch.js` (`isCodexDesktopApp()`) early-exits (cleanly, exit 0) when the app's `CODEX_INTERNAL_ORIGINATOR_OVERRIDE="Codex Desktop"` marker is present (the CLI sets `CODEX_MANAGED_BY_NPM` instead). The QR card has no good surface in the desktop app, so both the greeting and the nudge no-op there.
- **Zero-config self-provisioning.** Claude Code has no install hook, so a `SessionStart` hook runs `scripts/provision.js`: on first run it `POST /v1/register`s and writes the minted token + backend URL to `~/.hamster/config`. It's idempotent (a token already present → no-op), fail-soft (offline → silent, never disrupts the session), and serialized by a lockfile so concurrent sessions can't double-register. The nudge and `/wallet` re-run it as a fallback. The backend URL is resolved **env var → `~/.hamster/config` → shipped `hamster.defaults`** (`https://hamster.win`), so the production default is committed config, not hardcoded, and local dev overrides it with `HAMSTER_API_URL`.
- **The QR encodes `/go`, not raw Besitos** — so the offer is monitored and resolved at scan time (current + region/device-correct), not frozen when the QR was drawn.
- **Namespaced commands + bare installer.** Plugin commands are `/hamster:*` (a Claude Code constraint); `scripts/install-bare-commands.sh` symlinks the `wallet` skill into `~/.claude/skills/` for a bare `/wallet`.
- **No native deps in the hot path.** QR rendering is a vendored MIT `qrcode-generator` + Unicode half-blocks; the only JSON extraction on the bash side (`/play`) uses a Python helper, no `jq`.
- **Mock mode** (`MOCK_BESITOS=1`) — Besitos has no sandbox, so local dev ships fixtures, routes `/go` straight to the store, and accepts a `dev-secret` webhook signature. Production is `MOCK_BESITOS=0` (committed in `wrangler.jsonc`); `npm run dev` forces `--var MOCK_BESITOS:1` so local stays mocked without reverting prod.

---

## Deployment

| | |
| --- | --- |
| Domain | `hamster.win` (custom-domain route in `wrangler.jsonc`; needs the zone in the CF account) |
| Cloudflare account | `<your-cloudflare-account>` |
| D1 database | `play-to-win` (id in `wrangler.jsonc` → `database_id`) |
| Vars | `REWARD_SHARE=0.5`, `MOCK_BESITOS=0` |
| Secrets | `BESITOS_API_TOKEN`, `BESITOS_PARTNER_ID`, `BESITOS_WEBHOOK_SECRET` |
| Cron | daily reconcile `0 6 * * *` |

Verified live: `/v1/featured` returns real in-region offers via the User Data API; `/go` 302s to a Besitos redirect with `partner_user_id` bound; signed postbacks credit the ledger while forged/missing `verifier` → 401. Step-by-step redeploy + postback registration live in the **backend repo** (`growlads/hamster-play`): its `README.md` (**Production**) and `ARCHITECTURE.md`.

---

## Known risks / open items

- **Open registration** — `/v1/register` mints tokens with no auth (v0), and the plugin now auto-registers on first run, so every install creates a user. Gate it (invite codes / attestation / rate limiting) before real payouts; the webhook HMAC guards *crediting*, but registration guards who can hold a balance.
- **Region lock** — the phone must be in a Besitos-supported region; we detect/serve correctly per region but can't bypass Besitos' IP check.
- **Attribution without IDFA** — a web/QR click can't pass a device advertising id, so conversion matching relies on Besitos' click→install pipeline (and some inventory may require a device id). Validate fill/attribution rates with the account manager early.
- **Commercials** — Besitos rev-share, minimums, and payment timing are negotiated, not documented; `REWARD_SHARE` (default `0.5`) is just the knob.
- **Paying users out** — this system tracks the ledger; actual payouts (Stripe/etc.) are not built.
- **`/play` keystroke driving is best-effort** — the mirror exposes nothing to Accessibility, so timing is delay-based and unverifiable; fallbacks exist everywhere. EU has no iPhone Mirroring (QR path still works).
