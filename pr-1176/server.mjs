// Two origins: ASSETS (our Pages deploy, serves dist/) and HOST (the MCP host,
// serves the host page and the sandboxed frame with the spec's CSP).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const DIST = process.argv[2];
const A = 'http://127.0.0.1:4801', H = 'http://localhost:4802';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.xml': 'text/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif' };
http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(new URL(req.url, A).pathname));
  if (!p.startsWith(DIST) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' });
  fs.createReadStream(p).pipe(res);
}).listen(4801, '127.0.0.1');
const csp = (rd, cd) => [`default-src 'none'`, `script-src 'self' 'unsafe-inline' ${rd}`, `style-src 'self' 'unsafe-inline' ${rd}`,
  `connect-src 'self' ${cd}`, `img-src 'self' data: ${rd}`, `font-src 'self' ${rd}`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`].join('; ');
http.createServer((req, res) => {
  const u = new URL(req.url, H);
  if (u.pathname === '/frame') {
    const html = fs.readFileSync(path.join(DIST, 'mcp-app/view.html'), 'utf8')
      .replace(/\b(src|href)="\.\/([^"]*)"/g, (_, a, v) => `${a}="${A}/mcp-app/${v}"`);
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': csp(`${A} https://www.plantuml.com`, u.searchParams.get('connect') ?? A) });
    return res.end(html);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><body style="margin:0"><iframe id=f sandbox="${u.searchParams.get('sandbox') ?? 'allow-scripts'}" src="/frame?connect=${encodeURIComponent(u.searchParams.get('connect') ?? A)}" style="width:900px;height:100px;border:1px solid #ccc"></iframe>
<script>
window.log=[];const f=document.getElementById('f');
addEventListener('message',e=>{const m=e.data;window.log.push(m.method||('resp:'+m.id));
  if(m.method==='ui/initialize')f.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'sim',version:'1'},hostCapabilities:{},hostContext:{}}},'*');
  if(m.method==='ui/notifications/initialized')f.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:window.PAYLOAD}},'*');
  if(m.method==='ui/notifications/size-changed'){f.style.height=m.params.height+'px';window.lastSize=m.params;}
});
</script>`.replace('window.PAYLOAD', `JSON.parse(atob('${u.searchParams.get('p')}'))`));
}).listen(4802, 'localhost');
