"""Inject a private GhostBar frame; forward its API to the local app."""
import asyncio
import html as html_lib
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
    """Allow our elements without making any existing permission stricter.

    Adding a nonce disables unsafe-inline. Missing directives impose no limit
    unless they have a fallback; inventing script/style-src blocks page code.
    Only extend effective element directives, leaving attributes, eval, workers
    and all unrelated directives with their original semantics.
    """
    policies = []
    for serialized in policy.split(","):
        parts = serialized.split(";")
        directives = {}
        for index, part in enumerate(parts):
            tokens = part.strip().split()
            # CSP uses the first occurrence of a duplicated directive.
            if tokens and tokens[0].lower() not in directives:
                directives[tokens[0].lower()] = (index, tokens[1:])

        def effective(names):
            return next((directives[name][1] for name in names if name in directives), None)

        def set_directive(name, values):
            text = name + " " + " ".join(values)
            if name in directives:
                parts[directives[name][0]] = text
            else:
                parts.append(text)

        for kind in ("script", "style"):
            name = kind + "-src-elem"
            values = effective((name, kind + "-src", "default-src"))
            if values is None:
                continue
            has_nonce_or_hash = any(re.match(r"'(?:nonce-|sha(?:256|384|512)-)", v, re.I) for v in values)
            inline_allowed = ("'unsafe-inline'" in [v.lower() for v in values]
                              and not has_nonce_or_hash
                              and not (kind == "script" and "'strict-dynamic'" in [v.lower() for v in values]))
            if not inline_allowed:
                set_directive(name, [v for v in values if v.lower() != "'none'"] + ["'nonce-" + nonce + "'"])

        values = effective(("frame-src", "child-src", "default-src"))
        if values is not None and PANEL_ORIGIN not in values:
            set_directive("frame-src", [v for v in values if v.lower() != "'none'"] + [PANEL_ORIGIN])
        policies.append(";".join(parts))
    return ",".join(policies)


# Skip comments and raw-text elements when locating tags. The bundled proxy
# runtime deliberately omits html.parser, so this scanner has no extra imports.
HTML_TAGS = re.compile(r'''<!--.*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>.*?</\1\s*>|<meta\b(?:[^'">]|"[^"]*"|'[^']*')*>|</body\s*>''', re.I | re.S)
ATTRIBUTES = re.compile(r'''(\s+[^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?''')


def inject_html(source, snippet, nonce):
    edits = []
    body_end = len(source)
    for tag in HTML_TAGS.finditer(source):
        raw = tag.group(0)
        if raw.lower().startswith("</body"):
            body_end = tag.start()
        elif raw.lower().startswith("<meta"):
            attributes = {}
            for match in ATTRIBUTES.finditer(raw):
                value = match.group(2) or ""
                if value[:1] in ("'", '"'):
                    value = value[1:-1]
                attributes.setdefault(match.group(1).strip().lower(), (html_lib.unescape(value), match))
            if attributes.get("http-equiv", ("",))[0].lower() != "content-security-policy" or "content" not in attributes:
                continue
            value, match = attributes["content"]
            policy = extend_csp(value, nonce)
            replacement = ' content="' + html_lib.escape(policy, quote=True) + '"'
            edits.append((tag.start() + match.start(), tag.start() + match.end(), replacement))
    edits.append((body_end, body_end, snippet))
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    return source


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
        # Prepare the whole edit first. A failed optional injection must leave
        # the original website usable and its security policy unchanged.
        try:
            with open(SNIPPET, encoding="utf-8") as source:
                snippet = source.read().replace("__GHOSTBAR_NONCE__", nonce)
            updated = inject_html(html, snippet, nonce)
            policies = flow.response.headers.get_all("content-security-policy")
            updated_policies = [extend_csp(p, nonce) for p in policies]
        except (OSError, ValueError, UnicodeError):
            return
        flow.response.set_text(updated)
        if policies:
            flow.response.headers.set_all("content-security-policy", updated_policies)
        flow.response.headers.pop("etag", None)
        flow.response.headers.pop("content-md5", None)
        flow.response.headers["cache-control"] = "no-store"


addons = [GhostBar()]
