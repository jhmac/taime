#!/bin/bash
set -e
npm install

# Run db:push non-interactively.
# Both invocations pipe "1" to answer any interactive prompt (e.g. enum renames).
# The final || true ensures the script never aborts npm install on db failure.
echo "1" | npm run db:push -- --accept-data-loss \
  || echo "1" | npm run db:push -- --accept-data-loss \
  || true
