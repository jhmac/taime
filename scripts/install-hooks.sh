#!/bin/bash
# Installs the project's git hooks into .git/hooks/.
# Run this once after cloning the repository:
#   bash scripts/install-hooks.sh
#
# Hook execution order for the pre-commit hook:
#   .husky/pre-commit        (credential-file guard — this script)
#     └─> scripts/hooks/pre-commit  (migration validation — chained internally)
#
# All other hooks in scripts/hooks/ are symlinked directly.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
HOOKS_DEST="$REPO_ROOT/.git/hooks"

# Install the credential-guard hook as the primary pre-commit entry point.
# It already chains to scripts/hooks/pre-commit for migration validation.
HUSKY_PRECOMMIT="$REPO_ROOT/.husky/pre-commit"
DEST_PRECOMMIT="$HOOKS_DEST/pre-commit"

if [ -e "$DEST_PRECOMMIT" ] && [ ! -L "$DEST_PRECOMMIT" ]; then
  echo "WARNING: pre-commit already exists at $DEST_PRECOMMIT and is not a symlink."
  echo "         It will be replaced. Back it up first if you need it."
fi

ln -sf "$HUSKY_PRECOMMIT" "$DEST_PRECOMMIT"
chmod +x "$HUSKY_PRECOMMIT"
echo "Installed hook: pre-commit -> $DEST_PRECOMMIT (credential guard + migration validation)"

# Install all other hooks from scripts/hooks/ (skip pre-commit — handled above).
for hook in "$HOOKS_SRC"/*; do
  hook_name="$(basename "$hook")"
  [ "$hook_name" = "pre-commit" ] && continue

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
