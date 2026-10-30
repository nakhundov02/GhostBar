import json
import os, json, traceback
from mitmproxy import http

DATA_FILE    = os.path.expanduser("~/.ghostbar_data.json")
SNIPPET_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snippet.html")

STRIP = [
    "content-security-policy", "x-content-security-policy", "x-webkit-csp",
    "x-frame-options", "cross-origin-opener-policy", "cross-origin-embedder-policy",
    "cross-origin-resource-policy", "strict-transport-security", "permissions-policy",
    "cross-origin-resource-policy"
]

# Hosts we never inject into (API endpoints, etc.)
SKIP = {
    "generativelanguage.googleapis.com",
    "127.0.0.1", "localhost"
}

def load_key():
    """Read API key directly from the GhostBar data file."""
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f).get("gem_key", "")
    except Exception:
        return ""

class GhostBar:
    def response(self, flow: http.HTTPFlow):
        # Always strip security headers so our injected JS can run
        for h in STRIP:
            flow.response.headers.pop(h, None)
        flow.response.headers["access-control-allow-origin"] = "*"
        flow.response.headers["access-control-allow-methods"] = "GET, POST, OPTIONS"

        # Only inject into HTML pages, skip API hosts
        ct = flow.response.headers.get("content-type", "").lower()
        if "text/html" not in ct:
            return
        if flow.request.host in SKIP:
            return

        try:
            html  = flow.response.get_text(strict=False)
            snip  = open(SNIPPET_FILE, encoding="utf-8").read()
            key   = load_key()

            # Inject key directly as a JS variable — no localhost fetch needed.
            # This works in SEB and any browser that blocks local network requests.
            data = json.loads(open(DATA_FILE).read()) if os.path.exists(DATA_FILE) else {}
            tier = data.get('tier', 'free')
            key_script = f'<script>window.__GHOSTBAR_KEY__="{key}";window.__GHOSTBAR_TIER__="{tier}";</script>\n'

            # Inject before </body> — most reliable position
            tag = "</body>"
            idx = html.lower().rfind(tag)
            if idx != -1:
                html = html[:idx] + "\n" + key_script + snip + html[idx:]
            else:
                html = html + "\n" + key_script + snip

            flow.response.set_text(html)
            print(f"✅ GhostBar injected → {flow.request.pretty_url[:80]}")

        except Exception as e:
            print(f"❌ Injection failed on {flow.request.pretty_url}")
            traceback.print_exc()

addons = [GhostBar()]
