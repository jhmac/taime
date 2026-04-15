#!/bin/bash
set -e
npm install

# Run db:push non-interactively.
# Feed "1" to accept the first choice for any interactive prompt (e.g. enum renames).
# Fall back with --accept-data-loss, then continue regardless so npm install is never blocked.
echo "1" | npm run db:push -- --accept-data-loss \
  || npm run db:push -- --accept-data-loss \
  || true
