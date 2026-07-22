#!/usr/bin/env python3
"""Static preview server for DreamHome prototype with caching disabled.

Same as `python -m http.server 5180 --directory web`, but every response
carries no-cache headers so the browser always fetches the latest files.
Avoids stale pages during design iteration.

Usage: python3 serve-nocache.py [port] [directory]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "web"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # Never answer 304 from a stale conditional request; no-store makes the
    # browser refetch, but drop these defensively in case an old entry lingers.
    def send_head(self):
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]
        return super().send_head()


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=DIRECTORY)
    with ThreadingHTTPServer(("", PORT), handler) as httpd:
        print(f"Serving '{DIRECTORY}/' at http://127.0.0.1:{PORT}/ (no-cache)")
        httpd.serve_forever()
