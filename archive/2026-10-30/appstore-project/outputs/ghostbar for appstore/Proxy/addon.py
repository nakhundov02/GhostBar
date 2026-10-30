"""Bridge the existing mitmproxy engine to GhostBar's native, Keychain-backed broker."""
import asyncio
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http

sys.path.insert(0, str(Path(__file__).parent))
from injection import transform

BROKER = 'http://127.0.0.1:' + os.environ['GHOSTBAR_BROKER_PORT']
SECRET = os.environ['GHOSTBAR_BROKER_SECRET']
PREFIX = '/__ghostbar_' + secrets.token_hex(16) + '/'
SCRIPT = (Path(__file__).parent.parent / 'Web' / 'panel.js').read_text()
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def broker(path, payload):
    request = urllib.request.Request(BROKER + path, data=json.dumps(payload).encode(),
                                    headers={'Authorization': 'Bearer ' + SECRET, 'Content-Type': 'application/json'})
    try:
        with OPENER.open(request, timeout=85) as response:
            return response.status, response.read(256 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, error.read(256 * 1024)


def reply(status, body):
    return http.Response.make(status, body, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


class GhostBar:
    async def request(self, flow):
        if not urlsplit(flow.request.url).path.startswith(PREFIX):
            return
        if flow.request.method != 'POST' or len(flow.request.raw_content or b'') > 192 * 1024:
            flow.response = reply(400, b'{"error":"Invalid request."}')
            return
        try:
            payload = json.loads(flow.request.content)
            payload['session'] = flow.request.headers.get('X-GhostBar-Session', '')
            payload['origin'] = self.origin(flow)
            status, body = await asyncio.to_thread(broker, '/chat', payload)
            flow.response = reply(status, body)
        except Exception:
            flow.response = reply(503, b'{"error":"GhostBar is unavailable. Open the GhostBar app."}')

    @staticmethod
    def origin(flow):
        url = urlsplit(flow.request.url)
        return url.scheme + '://' + url.netloc

    async def response(self, flow):
        if not flow.response or flow.request.path.startswith(PREFIX):
            return
        if not flow.response.headers.get('content-type', '').lower().startswith('text/html'):
            return
        if flow.response.status_code != 200 or 'attachment' in flow.response.headers.get('content-disposition', ''):
            return
        if flow.request.headers.get('sec-fetch-dest', 'document') not in ('document', ''):
            return
        try:
            html = flow.response.get_text(strict=True)
            policies = flow.response.headers.get_all('content-security-policy')
            # Preflight without registering an unusable session.
            if transform(html, SCRIPT, '', '', policies) is None:
                return
            status, body = await asyncio.to_thread(broker, '/register', {'origin': self.origin(flow)})
            if status != 200:
                return
            session = json.loads(body)['session']
            transformed = transform(html, SCRIPT, session, PREFIX + 'chat', policies)
            if transformed is None:
                return
            html, policies = transformed
            flow.response.set_text(html)
            if policies:
                flow.response.headers.set_all('content-security-policy', policies)
            flow.response.headers['cache-control'] = 'no-store'
            for header in ('etag', 'content-md5', 'digest', 'content-digest'):
                flow.response.headers.pop(header, None)
        except Exception:
            # A transformation failure must leave the upstream page usable.
            return


addons = [GhostBar()]
