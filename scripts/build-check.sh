#!/bin/sh
# RaktSetu verification: application-level rule checks, then a production
# build (the build also type-checks every route and component).
# Detailed build output: /tmp/rs-build.log
cd "$(dirname "$0")/.." || exit 1

echo "== rule checks (geo, blood-group rules, availability/cooldown, matching) =="
if ! sh scripts/check-rules.sh; then
  echo "RULE_CHECKS=FAIL"
  exit 1
fi
echo "RULE_CHECKS=PASS"

echo ""
echo "== SQL/TS compatibility checks =="
if ! sh scripts/check-sql-sync.sh; then
  echo "SQL_SYNC=FAIL"
  exit 1
fi
echo "SQL_SYNC=PASS"

echo ""
echo "== production build =="
npx next build > /tmp/rs-build.log 2>&1
BUILD_STATUS=$?
echo "BUILD_EXIT_CODE=$BUILD_STATUS" >> /tmp/rs-build.log
tail -25 /tmp/rs-build.log
exit $BUILD_STATUS
