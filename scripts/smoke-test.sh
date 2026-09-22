#!/bin/sh
# Starts a local production server and requests every route once.
# Results: /tmp/rs-routes.txt   Server log: /tmp/rs-server.log
cd "$(dirname "$0")/.." || exit 1

PORT=3111
OUT=/tmp/rs-routes.txt
: > "$OUT"

# Make sure nothing stale is holding the port (an old server would serve an
# old build and silently produce misleading results).
STALE=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$STALE" ]; then
  echo "stopping stale server on :$PORT (pid $STALE)" >> "$OUT"
  kill $STALE 2>/dev/null
  sleep 2
fi

npx next start -p $PORT > /tmp/rs-server.log 2>&1 &
SERVER_PID=$!

# Wait for the server to actually answer before testing routes.
READY=0
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://localhost:$PORT/"; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "SERVER_FAILED_TO_START" >> "$OUT"
  cat /tmp/rs-server.log >> "$OUT"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

for route in / /login /register /forgot-password /reset-password /auth/callback /dashboard /dashboard/donor /dashboard/requester /dashboard/volunteer /dashboard/admin /profile /profile/donor /profile/volunteer /request-blood /donor /admin /about /contact /nope-does-not-exist; do
  code=$(curl -s -o /tmp/rs-body.html -w "%{http_code}" "http://localhost:$PORT${route}")
  title=$(grep -o "<title>[^<]*</title>" /tmp/rs-body.html | head -1)
  echo "$route -> HTTP $code ${title}" >> "$OUT"
done
curl -s "http://localhost:$PORT/" > /tmp/rs-home.html
grep -c "reach donors nearby" /tmp/rs-home.html >> "$OUT"
curl -s -I "http://localhost:$PORT/" | grep -iE "x-frame|nosniff|referrer|permissions|powered" >> "$OUT"
kill $SERVER_PID 2>/dev/null
echo DONE >> "$OUT"
