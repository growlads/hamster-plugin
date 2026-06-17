# Disabled surfaces

This release of the Hamster plugin ships only the **session nudge** and **`/stats`**.
The three play surfaces below are fully built but **not enabled** — their code lives
here, mirroring the layout it would have under `plugins/hamster/`, so re-enabling is
a move-back plus a small hooks edit. The backend already exposes every endpoint they
use, so nothing changes server-side.

| Surface | What it is | Files here |
| --- | --- | --- |
| **`/qr`** | On-demand: render a scannable QR for a live game in the terminal (any OS). | `commands/qr.md`, `scripts/qr/{render-qr.js,show-qr.sh,show-qr.ps1}` |
| **`/hub`** | Opens the browser hub (earnings, games, how it works). | `commands/hub.md`, `scripts/hub/{open-hub.sh,open-hub.ps1}` |
| **`/play`** | Mac iPhone-mirroring flow — launches the game on your phone. | `skills/play/` (incl. `scripts/`) |

> Note: `scripts/qr/render-qr.js` here `require()`s `qr-block.js`, which stays live at
> `plugins/hamster/scripts/qr/qr-block.js` (the session nudge needs it). The relative
> path resolves once `render-qr.js` is moved back to its original location.

## Re-enabling a surface

1. **Move the files back** to their mirrored paths under `plugins/hamster/`
   (e.g. `disabled/commands/qr.md` → `plugins/hamster/commands/qr.md`,
   `disabled/scripts/hub/` → `plugins/hamster/scripts/hub/`,
   `disabled/skills/play/` → `plugins/hamster/skills/play/`).

2. **For `/qr` and `/hub`**, re-add their `UserPromptExpansion` hooks to
   `plugins/hamster/hooks/hooks.json`. They were removed when these surfaces were
   disabled; the original blocks were:

   ```json
   {
     "matcher": "(^|:)qr$",
     "hooks": [
       { "type": "command", "shell": "bash",       "command": "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/qr/show-qr.sh\"" },
       { "type": "command", "shell": "powershell", "command": "& \"${CLAUDE_PLUGIN_ROOT}/scripts/qr/show-qr.ps1\"" }
     ]
   },
   {
     "matcher": "(^|:)hub$",
     "hooks": [
       { "type": "command", "shell": "bash",       "command": "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/hub/open-hub.sh\"" },
       { "type": "command", "shell": "powershell", "command": "& \"${CLAUDE_PLUGIN_ROOT}/scripts/hub/open-hub.ps1\"" }
     ]
   }
   ```

   They go under `hooks.UserPromptExpansion` (an array), alongside the existing
   `UserPromptSubmit` nudge hook.

3. **For `/play`**, optionally re-add `link_skill "play"` to
   `plugins/hamster/scripts/install-bare-commands.sh` so a bare `/play` is installable.

4. **Restore the docs/copy** if you want them surfaced: the command tables in the two
   `README.md`s, the descriptions in `plugin.json` / `marketplace.json`, and the
   nudge's `/hamster:stats → earnings` line in `scripts/qr/nudge.js` (it pointed to
   `/hamster:hub` while `/hub` was live).

5. **Fully restart Claude Code** so commands, skills, and hooks re-register.
