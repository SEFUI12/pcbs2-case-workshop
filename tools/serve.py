"""Serve the workshop over HTTP for the cases where file:// is not enough.

The tool is designed to run by double-clicking index.html. This server exists
for two situations: a browser that refuses file:// entirely, and the icon
export step, which needs the icons to be reachable while you iterate.

  python tools/serve.py            # http://127.0.0.1:8770
  python tools/serve.py --port 9000
  python tools/serve.py --open     # also open the default browser
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading
import webbrowser


class Handler(http.server.SimpleHTTPRequestHandler):
    """Quiet, no-cache, and rooted at web/."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=kwargs.pop("directory"), **kwargs)

    def end_headers(self):
        # Editing a case and reloading must not serve a stale build.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            sys.stderr.write("  404 %s\n" % (fmt % args))


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="Serve the PCBS2 Case Workshop locally.")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address (keep it on localhost)")
    ap.add_argument("--open", action="store_true", help="open a browser window")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    web = os.path.join(os.path.dirname(here), "web")
    if not os.path.isdir(web):
        sys.exit("web/ folder missing next to tools/")

    if not os.path.isfile(os.path.join(web, "data", "vanilla_cases.js")):
        sys.exit("data/vanilla_cases.js missing - run tools/extract_vanilla.py "
                 "and tools/build_data_js.py first")

    url = "http://%s:%d/" % (args.host, args.port)
    httpd = Server((args.host, args.port), lambda *a, **kw: Handler(*a, directory=web, **kw))

    print("PCBS2 Case Workshop")
    print("  %s" % url)
    print("  serving %s" % web)
    print("  Ctrl+C to stop")

    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        return 0
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())