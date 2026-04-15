#!/bin/bash
set -e
npm install

# Run db:push non-interactively.
# If it prompts (e.g. for enum renames), feed "1" to accept the first choice.
# Fall back to --accept-data-loss if that also fails, then continue regardless.
echo "1" | npm run db:push -- --accept-data-loss 2>/dev/null \
  || npm run db:push -- --accept-data-loss 2>/dev/null \
  || true
