#!/usr/bin/env bash
# usage: table.sh <base> <out>: status, content type and the key field of every discovery URL, plus asset checks
base=$1; out=$2; : > "$out"
st(){ grep -E '^HTTP/[0-9.]+ [0-9]+' | grep -v 'Connection Established' | tail -1 | awk '{print $2}'; }
for p in /.well-known/oauth-authorization-server /.well-known/oauth-authorization-server/agent-link /.well-known/oauth-authorization-server/mcp /.well-known/oauth-authorization-server/mcp/render /.well-known/oauth-protected-resource /.well-known/oauth-protected-resource/agent-link/mcp /.well-known/oauth-protected-resource/mcp /.well-known/oauth-protected-resource/mcp/render; do
  b=$(mktemp); r=$(curl -s -D - -o "$b" "$base$p"); ct=$(echo "$r" | grep -i '^content-type' | tail -1 | tr -d '\r' | cut -d' ' -f2)
  key=$(python3 -c 'import json,sys
try:
  d=json.load(open(sys.argv[1]))
  print("issuer="+d["issuer"] if "issuer" in d else ("authorization_servers="+",".join(d["authorization_servers"]) if "authorization_servers" in d else d.get("error","")))
except Exception: print("(not JSON)")' "$b")
  echo "GET $p -> $(echo "$r" | st) $ct $key" >> "$out"; rm -f "$b"
done
for p in /mcp-app/assets/does-not-exist.js; do r=$(curl -s -D - -o /dev/null "$base$p"); echo "GET $p -> $(echo "$r" | st) $(echo "$r" | grep -i '^content-type' | tr -d '\r' | cut -d' ' -f2) $(echo "$r" | grep -i '^cache-control' | tr -d '\r')" >> "$out"; done
v=$(curl -s "$base/mcp-app/view.html" | grep -o 'assets/view-[^"]*\.js' | head -1); [ -z "$v" ] && v=$(curl -sL "$base/mcp-app/view" | grep -o 'assets/view-[^"]*\.js' | head -1)
r=$(curl -s -D - -o /dev/null "$base/mcp-app/$v"); echo "GET /mcp-app/$v -> $(echo "$r" | st) $(echo "$r" | grep -i '^cache-control' | tr -d '\r')" >> "$out"
cat "$out"
