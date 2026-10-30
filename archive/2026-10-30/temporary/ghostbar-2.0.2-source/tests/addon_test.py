import importlib.util
import pathlib
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.modules["mitmproxy"] = types.SimpleNamespace(http=types.SimpleNamespace(HTTPFlow=object))
spec = importlib.util.spec_from_file_location("addon", ROOT / "core/addon.py")
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
addon.SNIPPET = str(ROOT / "src/snippet.html")

class Headers(dict):
    def get_all(self, key):
        value = self.get(key)
        return [value] if value else []
    def set_all(self, key, values):
        self[key] = values[0]

class Response:
    def __init__(self):
        self.headers = Headers({
            "content-type": "text/html",
            "content-security-policy": "default-src 'self'; script-src 'none'; object-src 'none'",
            "strict-transport-security": "max-age=31536000",
            "x-frame-options": "DENY"
        })
        self.text = "<html><body><p>Test page</p></body></html>"
    def get_text(self, strict=False):
        return self.text
    def set_text(self, value):
        self.text = value

class AddonTests(unittest.TestCase):
    def test_injects_without_keys_or_removing_unrelated_protections(self):
        flow = types.SimpleNamespace(request=types.SimpleNamespace(host="example.com", headers={}), response=Response())
        addon.GhostBar().response(flow)
        self.assertIn("ghostbar-mount", flow.response.text)
        self.assertNotIn("__GHOSTBAR_NONCE__", flow.response.text)
        self.assertNotIn("__GHOSTBAR_KEY__", flow.response.text)
        self.assertEqual(flow.response.headers["x-frame-options"], "DENY")
        self.assertEqual(flow.response.headers["strict-transport-security"], "max-age=31536000")
        self.assertIn("object-src 'none'", flow.response.headers["content-security-policy"])
        self.assertIn("https://ghostbar.test", flow.response.headers["content-security-policy"])
    def test_auth_hosts_are_never_modified(self):
        for host in ["auth.openai.com", "api.openai.com", "chatgpt.com"]:
            response = Response()
            before = response.text
            flow = types.SimpleNamespace(request=types.SimpleNamespace(host=host, headers={}), response=response)
            addon.GhostBar().response(flow)
            self.assertEqual(response.text, before)

    def test_monitor_service_responses_are_not_modified(self):
        for host in ["smc-service-cloud.respondus2.com", "static-public-downloads-cloud.respondus.com",
                     "server-profiles-respondus-com.s3-external-1.amazonaws.com", "d1hvyp8wapcgir.cloudfront.net"]:
            response = Response()
            before = response.text
            headers = dict(response.headers)
            flow = types.SimpleNamespace(request=types.SimpleNamespace(host=host, headers={}), response=response)
            addon.GhostBar().response(flow)
            self.assertEqual(response.text, before)
            self.assertEqual(dict(response.headers), headers)

if __name__ == "__main__":
    unittest.main()
