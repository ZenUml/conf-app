"""Hold Mermaid module requests and proxy all other traffic to local Vite.

Set VITE_UPSTREAM (default http://127.0.0.1:6017) to the local Storybook/Vite
server. Start this proxy, then set PROXY_URL to its printed origin for the
browser-probe.py capture. /__repro/hold and /__repro/release control the hold.
"""
import http.server
import json
import os
import threading
import urllib.request

upstream = os.environ.get("VITE_UPSTREAM", "http://127.0.0.1:6017").rstrip("/")
release = threading.Event()
release.set()
held = 0


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        global held
        if self.path.startswith("/__repro/"):
            if self.path.endswith("/hold"):
                release.clear()
            elif self.path.endswith("/release"):
                release.set()
            body = json.dumps({"held_requests": held, "released": release.is_set()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] == "/vendor/mermaid/mermaid.esm.min.mjs" and not release.is_set():
            held += 1
            release.wait(120)
        try:
            request = urllib.request.Request(upstream + self.path, headers={"Accept-Encoding": "identity"})
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() not in {"connection", "transfer-encoding", "content-length", "content-encoding"}:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_error(502)


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print("Proxy origin: http://127.0.0.1:%s" % server.server_port, flush=True)
server.serve_forever()
