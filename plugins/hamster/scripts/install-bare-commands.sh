#!/usr/bin/env bash
# install-bare-commands.sh — symlink the plugin's skills into ~/.claude/skills so
# that bare /wallet works (in addition to the namespaced /hamster:wallet).
#
# Refuses to overwrite an existing non-symlink directory (your own skill).
set -euo pipefail

# Resolve the plugin root from this script's own location: scripts/ -> plugin root.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_SRC="$PLUGIN_ROOT/skills"

DEST_DIR="$HOME/.claude/skills"
mkdir -p "$DEST_DIR"

link_skill() {
  local name="$1"
  local src="$SKILLS_SRC/$name"
  local dest="$DEST_DIR/$name"

  if [[ ! -d "$src" ]]; then
    echo "ERROR: source skill not found: $src" >&2
    return 1
  fi

  if [[ -L "$dest" ]]; then
    # Existing symlink — repoint it (safe to replace our own link).
    rm "$dest"
    ln -s "$src" "$dest"
    echo "Updated symlink: $dest -> $src"
  elif [[ -e "$dest" ]]; then
    echo "SKIP: $dest already exists and is NOT a symlink. Refusing to overwrite." >&2
    echo "      Remove or rename it yourself if you want the bare /$name command." >&2
    return 0
  else
    ln -s "$src" "$dest"
    echo "Created symlink: $dest -> $src"
  fi
}

link_skill "wallet"

echo ""
echo "Done. Restart Claude Code (or reload skills) so bare /wallet appears."
