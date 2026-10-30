"""Inject a private GhostBar frame; forward its API to the local app."""
import asyncio
import os
import re
import secrets
import urllib.request
import urllib.error
from mitmproxy import http

PANEL_HOST = "ghostbar.test"
PANEL_ORIGIN = "https://" + PANEL_HOST
PORT = os.environ.get("GHOSTBAR_BRIDGE_PORT", "")
SECRET = os.environ.get("GHOSTBAR_BRIDGE_SECRET", "")
SNIPPET = os.environ.get("GHOSTBAR_SNIPPET", "")
SKIP = ("openai.com", "chatgpt.com", "googleapis.com",
        "respondus.com", "respondus2.com", "amazonaws.com", "cloudfront.net", "knowledgeowl.com")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def extend_csp(policy, nonce):
    directives = {}
    for part in policy.split(";"):
        tokens = part.strip().split()
        if tokens:
            directives[tokens[0].lower()] = tokens[1:]
    for key, fallback in (("script-src", "default-src"), ("script-src-elem", "script-src"),
                          ("style-src", "default-src"), ("style-src-elem", "style-src")):
        values = directives.get(key, directives.get(fallback, ["*"]))
        directives[key] = [v for v in values if v != "'none'"] + ["'nonce-" + nonce + "'"]
    values = directives.get("frame-src", directives.get("child-src", directives.get("default-src", ["*"])))
    directives["frame-src"] = [v for v in values if v != "'none'"] + [PANEL_ORIGIN]
    return "; ".join(key + " " + " ".join(values) for key, values in directives.items())


def forward(method, route, body, origin, marker):
    request = urllib.request.Request(
        "http://127.0.0.1:" + PORT + route, data=body if method == "POST" else None,
        method=method, headers={"Authorization": "Bearer " + SECRET,
                               "Content-Type": "application/json",
                               "X-GhostBar-Origin": origin, "X-GhostBar-Request": marker})
    try:
        response = OPENER.open(request, timeout=195)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        # Never relay OAuth credentials, cookies or internal authentication headers.
        headers = {key: value for key, value in response.headers.items()
                   if key.lower() in ("content-type", "content-security-policy", "cache-control", "x-content-type-options", "cross-origin-resource-policy", "cross-origin-embedder-policy")}
        return http.Response.make(response.status, response.read(), headers)


class GhostBar:
    async def request(self, flow: http.HTTPFlow):
        if flow.request.host.lower() != PANEL_HOST:
            return
        if flow.request.scheme != "https":
            flow.response = http.Response.make(400, b"Use HTTPS.")
            return
        route = flow.request.path.split("?")[0]
        allowed = {"/", "/panel.js", "/panel.css", "/api/status", "/api/models", "/api/chat"}
        if route not in allowed or flow.request.method not in ("GET", "POST"):
            flow.response = http.Response.make(404, b"Not found")
            return
        if len(flow.request.raw_content or b"") > 13 * 1024 * 1024:
            flow.response = http.Response.make(413, b"Request too large")
            return
        origin = flow.request.headers.get("origin", "")
        marker = flow.request.headers.get("x-ghostbar-request", "")
        if route.startswith("/api/") and (origin != PANEL_ORIGIN or marker != "1"):
            flow.response = http.Response.make(403, b"Forbidden")
            return
        try:
            flow.response = await asyncio.to_thread(forward, flow.request.method, route,
                                                    flow.request.raw_content, origin, marker)
        except Exception:
            flow.response = http.Response.make(502, b'{"error":"GhostBar is not available. Reopen the app."}',
                                               {"content-type": "application/json"})

    def response(self, flow: http.HTTPFlow):
        host = flow.request.host.lower()
        if host == PANEL_HOST or host in ("localhost", "127.0.0.1") or any(host == h or host.endswith("." + h) for h in SKIP):
            return
        if not flow.response or "text/html" not in flow.response.headers.get("content-type", "").lower():
            return
        if flow.request.headers.get("sec-fetch-dest", "document") != "document":
            return
        html = flow.response.get_text(strict=False)
        if not html or 'id="ghostbar-mount"' in html or len(html) > 8_000_000:
            return
        nonce = secrets.token_urlsafe(24)
        with open(SNIPPET, encoding="utf-8") as source:
            snippet = source.read().replace("__GHOSTBAR_NONCE__", nonce)
        policies = flow.response.headers.get_all("content-security-policy")
        if policies:
            flow.response.headers.set_all("content-security-policy", [extend_csp(p, nonce) for p in policies])
        # Extend any meta CSP as well, preserving every unrelated directive.
        def update_meta(match):
            tag = match.group(0)
            if not re.search(r'http-equiv\s*=\s*["\']content-security-policy["\']', tag, re.I):
                return tag
            def content(value):
                return value.group(1) + value.group(2) + extend_csp(value.group(3), nonce) + value.group(2)
            return re.sub(r'(content\s*=\s*)(["\'])(.*?)\2', content, tag, flags=re.I | re.S)
        html = re.sub(r'<meta\b[^>]*>', update_meta, html, flags=re.I)
        position = html.lower().rfind("</body>")
        html = html[:position] + snippet + html[position:] if position >= 0 else html + snippet
        flow.response.set_text(html)
        flow.response.headers.pop("etag", None)
        flow.response.headers.pop("content-md5", None)
        flow.response.headers["cache-control"] = "no-store"


addons = [GhostBar()]
