#!/bin/zsh
cd /Users/rohankumar/Documents/Devang/RaktSetu
npx next build > /tmp/rs-build.log 2>&1
echo "BUILD_EXIT_CODE=$?" >> /tmp/rs-build.log
