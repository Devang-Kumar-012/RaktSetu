#!/bin/zsh
cd /Users/rohankumar/Documents/Devang/RaktSetu
PORT=3111 npx next start -p 3111 > /tmp/rs-server.log 2>&1 &
SERVER_PID=$!
sleep 6
: > /tmp/rs-routes.txt
for route in / /login /register /dashboard /request-blood /donor /admin /about /contact /nope-does-not-exist; do
  code=$(curl -s -o /tmp/rs-body.html -w "%{http_code}" "http://localhost:3111${route}")
  title=$(grep -o "<title>[^<]*</title>" /tmp/rs-body.html | head -1)
  echo "$route -> HTTP $code ${title}" >> /tmp/rs-routes.txt
done
# Confirm key content markers
curl -s http://localhost:3111/ > /tmp/rs-home.html
grep -c "reaches willing donors nearby" /tmp/rs-home.html >> /tmp/rs-routes.txt
grep -c "RaktSetu" /tmp/rs-home.html >> /tmp/rs-routes.txt
curl -s -I http://localhost:3111/ | grep -iE "x-frame|nosniff|referrer|permissions|powered" >> /tmp/rs-routes.txt
kill $SERVER_PID 2>/dev/null
echo DONE >> /tmp/rs-routes.txt
