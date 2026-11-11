import sys,json
from urllib.parse import urlparse
buf='';decoder=json.JSONDecoder()
for line in sys.stdin:
    buf+=line
    while True:
        i=buf.find('{')
        if i<0:buf='';break
        buf=buf[i:]
        try: row,end=decoder.raw_decode(buf)
        except json.JSONDecodeError:break
        buf=buf[end:]
        event=row.get('event') or {};req=event.get('request') or {}
        if urlparse(req.get('url','')).path!='/api/license-notice':continue
        response=event.get('response') or {}
        print(json.dumps({'timestamp':row.get('eventTimestamp'),'method':req.get('method'),'path':'/api/license-notice','status':response.get('status'),'outcome':row.get('outcome'),'exception_count':len(row.get('exceptions') or [])}),flush=True)
