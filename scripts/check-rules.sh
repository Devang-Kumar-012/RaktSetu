#!/bin/sh
# Runs RaktSetu's application-level rule checks (geo, blood-group
# compatibility, donor availability/cooldown). No database or credentials
# needed — these are pure functions, and they mirror the SQL in
# supabase/migrations/0003 and 0005.
set -e
cd "$(dirname "$0")/.."
npx -y tsx scripts/check-rules.ts
