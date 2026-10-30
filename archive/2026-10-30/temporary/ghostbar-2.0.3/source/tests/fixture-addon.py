"""Serve public test fixtures at a fake host inside the isolated test proxy."""
import os
import urllib.request
import urllib.error
from mitmproxy import http
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def request(flow):
    if flow.request.host == 'fixture.ghostbar.test':
        try:
            response = opener.open('http://127.0.0.1:' + os.environ['GHOSTBAR_FIXTURE_PORT'] + flow.request.path)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            flow.response = http.Response.make(response.status, response.read(), [(k.encode("latin1"), v.encode("latin1")) for k, v in response.headers.items()])
