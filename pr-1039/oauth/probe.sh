#!/usr/bin/env bash
# usage: probe.sh <base-url> <out-file>; records each discovery path's status, type and body start
base=$1; out=$2; dir=$(dirname "$out"); : > "$out"
status(){ grep -E '^HTTP/[0-9.]+ [0-9]+' | grep -v 'Connection Established' | tail -1 | awk '{print $2}'; }
for p in /.well-known/oauth-protected-resource/mcp/render /.well-known/oauth-protected-resource/agent-link/mcp /.well-known/oauth-protected-resource /.well-known/oauth-authorization-server /.well-known/oauth-authorization-server/mcp/render; do
  r=$(curl -s -D - -o "$dir/body" "$base$p")
  ct=$(echo "$r" | grep -i '^content-type' | tail -1 | tr -d '\r' | cut -d' ' -f2-)
  echo "GET $p -> $(echo "$r" | status) $ct :: $(head -c 110 "$dir/body" | tr '\n' ' ')" >> "$out"
done
r=$(curl -s -D - -o /dev/null -X POST "$base/agent-link/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
echo "POST /agent-link/mcp (no token) -> $(echo "$r" | status) $(echo "$r" | grep -i '^www-authenticate' | tr -d '\r')" >> "$out"
cat "$out"
