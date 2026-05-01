#!/bin/bash
set -e
npm install

# Push schema changes non-interactively.
# - "yes" piped in answers any rename/drop prompts ("create" is always option 1).
# - timeout 60 prevents the drizzle interactive prompt from hanging indefinitely.
# - Two attempts in case the first fails on a transient DB connection issue.
# - Final || true means a schema-push failure is non-fatal (app boots with existing schema).
(yes | timeout 60 npm run db:push -- --force) \
  || (yes | timeout 60 npm run db:push -- --force) \
  || true
