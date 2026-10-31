import json, sys, urllib.request, time
URL = sys.argv[1] if len(sys.argv) > 1 else "https://conf-stg-lite.zenuml.com/mcp/render"
def rpc(method, params=None, rid=1):
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, **({"params": params} if params is not None else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"content-type": "application/json", "user-agent": "zenuml-mcp-probe/1"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read() or b"null"), int((time.time() - t) * 1000)
def call(args):
    return rpc("tools/call", {"name": "render_diagram", "arguments": args})
rows = []
def row(name, ok, detail):
    rows.append((name, "PASS" if ok else "FAIL", detail)); print(f"{'PASS' if ok else 'FAIL'} | {name} | {detail}")

s, b, ms = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {"extensions": {"io.modelcontextprotocol/ui": {}}}, "clientInfo": {"name": "stg-probe"}})
r = b["result"]; row("initialize, no token", s == 200 and r["serverInfo"]["name"] == "zenuml-render" and "io.modelcontextprotocol/ui" in r["capabilities"]["extensions"], f"{s}, {r['serverInfo']}, protocol {r['protocolVersion']}, {ms} ms")
s, b, _ = rpc("tools/list"); t = b["result"]["tools"]
row("tools/list", [x["name"] for x in t] == ["render_diagram"] and t[0]["inputSchema"]["required"] == ["source"] and t[0]["_meta"]["ui"]["resourceUri"] == "ui://zenuml/diagram", f"tools={[x['name'] for x in t]}, required={t[0]['inputSchema']['required']}")
s, b, _ = rpc("resources/list"); uris = [x["uri"] for x in b["result"]["resources"]]
row("resources/list", "ui://zenuml/diagram" in uris and "zenuml://dsl-guide" in uris, f"{uris}")
s, b, ms = rpc("resources/read", {"uri": "ui://zenuml/diagram"}); c = b.get("result", {}).get("contents", [{}])[0]
row("resources/read view", c.get("mimeType") == "text/html;profile=mcp-app" and 'name="mcp-app"' in c.get("text", "") and (URL.rsplit("/mcp/",1)[0] + "/mcp-app/assets/") in c.get("text", ""), f"{c.get('mimeType')}, {len(c.get('text',''))} chars, absolute asset URLs, {ms} ms")
s, b, _ = rpc("resources/read", {"uri": "mermaid://dsl-guide"})
row("resources/read guide", len(b["result"]["contents"][0]["text"]) > 200, f"{len(b['result']['contents'][0]['text'])} chars")

cases = [
  ("sequence, given", {"diagramType": "sequence", "source": "A->B: hi"}, dict(diagramType="sequence", valid=True, detected=None)),
  ("sequence, detected", {"source": "A->B: hi\nB->C.method()"}, dict(diagramType="sequence", valid=True, detected=True)),
  ("mermaid, detected", {"source": "flowchart TD\n  A --> B"}, dict(diagramType="mermaid", valid=True, detected=True)),
  ("plantuml, detected", {"source": "@startuml\nAlice -> Bob: hi\n@enduml"}, dict(diagramType="plantuml", valid=True, detected=True)),
  ("graph, detected", {"source": "<mxGraphModel><root><mxCell id=\"0\"/></root></mxGraphModel>"}, dict(diagramType="graph", valid=True, detected=True)),
  ("openapi, detected", {"source": "openapi: 3.0.0\ninfo:\n  title: Demo\n  version: '1'\npaths: {}"}, dict(diagramType="openapi", valid=True, detected=True)),
  ("given type wins", {"diagramType": "sequence", "source": "flowchart TD\n  A --> B"}, dict(diagramType="sequence", detected=None)),
  ("sequence parse error", {"source": "A->B: hi\nif(x) {"}, dict(diagramType="sequence", valid=False, detected=True)),
  ("mermaid parse error", {"source": "flowchart TD\n  A --> "}, dict(diagramType="mermaid", valid=False, detected=True)),
]
for name, args, exp in cases:
    s, b, ms = call(args); r = b["result"]; sc = r.get("structuredContent", {})
    ok = s == 200 and not r.get("isError") and all(sc.get(k) == v for k, v in exp.items())
    errs = sc.get("errors")
    row(f"render_diagram: {name}", ok, f"type={sc.get('diagramType')} detected={sc.get('detected')} valid={sc.get('valid')}{' errors='+json.dumps(errs)[:120] if errs else ''} | \"{r['content'][0]['text'][:90]}\" | {ms} ms")

s, b, _ = call({"diagramType": "asyncapi", "source": "asyncapi: 2.6.0"}); r = b["result"]
row("unknown type refused", r.get("isError") is True and "left out to detect" in r["content"][0]["text"], r["content"][0]["text"][:110])
s, b, _ = call({"source": "  "}); row("empty source refused", b["result"].get("isError") is True, b["result"]["content"][0]["text"][:80])
s, b, _ = rpc("tools/call", {"name": "update_diagram", "arguments": {}}); row("unknown tool", b.get("error", {}).get("code") == -32601, json.dumps(b.get("error"))[:100])
