from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
import json,mimetypes,urllib.parse
P=Path(__file__).parent
CURRENT=json.loads((P/'current-resource.json').read_text())['result']['contents'][0]['text']
CANDIDATE=(P/'candidate-app/view.html').read_text()
reports={'current':[],'candidate':[]}
script='''<script>
const mode=MODE;
function report(data){fetch('/report?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
addEventListener('securitypolicyviolation',e=>report({kind:'csp',directive:e.violatedDirective,blocked:e.blockedURI.startsWith('data:')?'data:':e.blockedURI,source:e.sourceFile.split('/').pop(),line:e.lineNumber}));
addEventListener('error',e=>report({kind:'error',message:e.message,source:(e.filename||'').split('/').pop()}));
let ready=false;new MutationObserver(()=>{if(!ready&&document.querySelector('#app')?.textContent.includes('login()')){ready=true;report({kind:'ready',text:document.querySelector('#app').textContent.slice(0,500)});}}).observe(document.documentElement,{childList:true,subtree:true});
</script>'''
class H(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  u=urllib.parse.urlsplit(self.path);mode=urllib.parse.parse_qs(u.query).get('mode',['current'])[0];data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));reports[mode].append(data);(P/'fixture-reports.json').write_text(json.dumps(reports,indent=2));self.send_response(204);self.end_headers()
 def do_GET(self):
  u=urllib.parse.urlsplit(self.path)
  if u.path=='/status':content=json.dumps(reports).encode();mime='application/json';csp=None
  elif u.path=='/':
   mode=urllib.parse.parse_qs(u.query).get('mode',['current'])[0]
   content=('''<!doctype html><meta charset="utf-8"><title>Strict CSP font fixture</title><h1>Strict CSP — MODE</h1><iframe title="Actual MCP renderer" src="/view-MODE.html" style="width:95vw;height:700px;border:1px solid #aaa"></iframe><script>const f=document.querySelector('iframe');addEventListener('message',e=>{if(e.source!==f.contentWindow)return;const m=e.data;if(m.method==='ui/initialize'){f.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostCapabilities:{},hostInfo:{name:'local-acceptance-fixture',version:'1'}}},'*')}else if(m.method==='ui/notifications/initialized'){f.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{diagramType:'sequence',source:'User->WebApp.login() { WebApp->Auth.authenticate() { return token } return success }',title:'Strict CSP font test'}}},'*')}});</script>'''.replace('MODE',mode)).encode();mime='text/html';csp=None
  elif u.path in ['/view-current.html','/view-candidate.html']:
   mode='candidate' if 'candidate' in u.path else 'current';h=CANDIDATE if mode=='candidate' else CURRENT
   h=h.replace('<head>','<head>'+script.replace('MODE',json.dumps(mode)))
   content=h.encode();mime='text/html';csp="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://conf-lite.zenuml.com; style-src 'self' 'unsafe-inline' https://conf-lite.zenuml.com; font-src 'self' https://conf-lite.zenuml.com; img-src 'self' data: https://www.plantuml.com; connect-src 'self' https://conf-lite.zenuml.com;"
  else:
   f=P/'candidate-app'/u.path.lstrip('/')
   if not f.is_file():self.send_response(404);self.end_headers();return
   content=f.read_bytes();mime=mimetypes.guess_type(str(f))[0]or'application/octet-stream';csp=None
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store')
  if csp:self.send_header('Content-Security-Policy',csp)
  self.end_headers();self.wfile.write(content)
ThreadingHTTPServer(('127.0.0.1',8771),H).serve_forever()
