import base64, os, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        name = re.sub(r"[^a-zA-Z0-9_-]", "", self.path.strip("/")) or "shot"
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        b64 = body.split(",", 1)[-1]
        path = os.path.join(OUT, name + ".jpg")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(f"saved {path}".encode())

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 8124), H).serve_forever()
