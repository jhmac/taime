#!/bin/bash
# Installs the project's git hooks by symlinking them from scripts/hooks/ into .git/hooks/.
# Run this once after cloning the repository:
#   bash scripts/install-hooks.sh

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
HOOKS_DEST="$REPO_ROOT/.git/hooks"

for hook in "$HOOKS_SRC"/*; do
  hook_name="$(basename "$hook")"
  dest="$HOOKS_DEST/$hook_name"

  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "WARNING: $hook_name already exists at $dest and is not a symlink."
    echo "         It will be replaced. Back it up first if you need it."
  fi

  ln -sf "$hook" "$dest"
  chmod +x "$hook"
  echo "Installed hook: $hook_name -> $dest"
done

echo "All hooks installed."
