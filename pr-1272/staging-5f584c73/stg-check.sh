#!/bin/zsh
# usage: stg-check.sh <label>
# Opens the lite-stg spot-check page, records which Forge deploy the ZenUML macro
# iframe is served from, fetches that deploy's Workspace and zenuml-definition
# chunks, and screenshots the page. Prints a one-line verdict.
set -u
LABEL=$1
S=/private/tmp/claude-501/-Users-yanhuili-workspace-zenuml-conf-app--claude-worktrees-sharp-fermi-6a46a2/d46c058c-304d-4eee-afac-6eb8d3778579/scratchpad
D=$S/stg-$LABEL; mkdir -p $D
A(){ agent-browser --session conf-app --restore=stg "$@"; }
A set viewport 1280 1000 >/dev/null 2>&1
A open "https://lite-stg.atlassian.net/wiki/spaces/SD/pages/422384538" >/dev/null 2>&1
sleep 20
A eval "[...document.querySelectorAll('iframe')].map(f=>f.src).find(s=>s.includes('8ad26115'))" 2>/dev/null | tail -1 | tr -d '"' > $D/iframe-src.txt
A screenshot --full $D/page.png >/dev/null 2>&1
U=$(cat $D/iframe-src.txt)
B=$(echo "$U" | sed -E 's#\?.*$##; s#/[^/]*$#/#')
DEPLOY=$(echo "$B" | awk -F/ '{print $6}')
curl -s "$U" -o $D/index.html
for f in $(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' $D/index.html); do curl -s "$B$f" -o $D/$(basename $f); done
W=$(grep -ohE 'Workspace-[A-Za-z0-9_-]+\.js' $D/index-*.js | head -1)
LM=$(grep -ohE 'loadMermaid-[A-Za-z0-9_-]+\.js' $D/index-*.js | head -1)
curl -s "${B}assets/$W" -o $D/$W
curl -s "${B}assets/$LM" -o $D/$LM
DEF=$(grep -ohE 'zenuml-definition-[A-Za-z0-9_-]+\.js' $D/$LM | head -1)
curl -s "${B}assets/$DEF" -o $D/$DEF
WS=$(wc -c < $D/$W | tr -d ' '); DS=$(wc -c < $D/$DEF | tr -d ' ')
TW=$(grep -c tw-border-spacing $D/$W)
IMP=$(grep -oE 'from ?"\./zenuml\.esm-[^"]+"' $D/$DEF | head -1)
echo "$(date -u +%T)Z label=$LABEL deploy=$DEPLOY Workspace=$W ${WS}B tw-reset=$TW definition=$DEF ${DS}B imports=[$IMP]" | tee $D/verdict.txt
