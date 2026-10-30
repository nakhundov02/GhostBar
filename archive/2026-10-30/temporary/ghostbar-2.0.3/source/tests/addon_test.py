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

class PolicyTests(unittest.TestCase):
    def test_unrestricted_directives_are_not_invented(self):
        for policy in ["object-src 'none'; base-uri 'self'", "require-trusted-types-for 'script'", ""]:
            self.assertEqual(addon.extend_csp(policy, "fixture"), policy)

    def test_unsafe_inline_is_preserved(self):
        policy = "script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
        self.assertEqual(addon.extend_csp(policy, "fixture"), policy)

    def test_default_fallback_keeps_inline_scripts_styles_and_attributes(self):
        policy = "default-src 'self' 'unsafe-inline'"
        updated = addon.extend_csp(policy, "fixture")
        self.assertNotIn("nonce-", updated)
        self.assertNotIn("script-src", updated)
        self.assertNotIn("style-src", updated)
        self.assertIn("frame-src 'self' 'unsafe-inline' https://ghostbar.test", updated)

    def test_strict_policy_keeps_original_nonce_and_eval_permissions(self):
        policy = "script-src 'nonce-original' 'strict-dynamic' 'unsafe-eval'; worker-src 'self'"
        updated = addon.extend_csp(policy, "fixture")
        self.assertTrue(updated.startswith(policy))
        self.assertIn("script-src-elem 'nonce-original' 'strict-dynamic' 'unsafe-eval' 'nonce-fixture'", updated)
        self.assertNotIn("style-src", updated)

    def test_duplicate_directives_use_the_first_value(self):
        policy = "script-src 'unsafe-inline'; script-src 'none'"
        self.assertEqual(addon.extend_csp(policy, "fixture"), policy)

    def test_comma_separated_policies_keep_their_independent_permissions(self):
        policy = "script-src 'nonce-original', require-trusted-types-for 'script'"
        first, second = addon.extend_csp(policy, "fixture").split(",")
        self.assertIn("script-src-elem", first)
        self.assertEqual(second, " require-trusted-types-for 'script'")

    def test_existing_element_and_attribute_directives_stay_independent(self):
        policy = "script-src 'none'; script-src-elem 'unsafe-inline'; script-src-attr 'none'"
        self.assertEqual(addon.extend_csp(policy, "fixture"), policy)

    def test_script_literals_and_comments_are_not_rewritten(self):
        literal = '<meta http-equiv="content-security-policy" content="script-src none">'
        source = '<html><body><script>window.example = \'%s\';</script><!--%s--></body></html>' % (literal, literal)
        result = addon.inject_html(source, "<script>fixture</script>", "fixture")
        self.assertEqual(result, source.replace("</body>", "<script>fixture</script></body>"))

    def test_meta_entities_and_original_nonce_are_preserved(self):
        source = '<meta http-equiv="Content-Security-Policy" content="script-src &apos;nonce-original&apos;; style-src &apos;unsafe-inline&apos;">'
        updated = addon.inject_html(source, "", "fixture")
        self.assertIn("nonce-original", updated)
        self.assertIn("script-src-elem", updated)
        self.assertIn("nonce-fixture", updated)
        self.assertNotIn("style-src-elem", updated)

    def test_missing_snippet_leaves_original_page_and_headers_unchanged(self):
        original = addon.SNIPPET
        try:
            addon.SNIPPET = "/ghostbar-fixture-file-does-not-exist"
            response = Response()
            before = response.text, dict(response.headers)
            addon.GhostBar().response(types.SimpleNamespace(request=types.SimpleNamespace(host="example.com", headers={}), response=response))
            self.assertEqual((response.text, dict(response.headers)), before)
        finally:
            addon.SNIPPET = original

    def test_non_document_responses_are_not_modified(self):
        for destination in ["script", "style", "empty", "iframe", "image"]:
            response = Response()
            before = response.text, dict(response.headers)
            addon.GhostBar().response(types.SimpleNamespace(request=types.SimpleNamespace(host="example.com", headers={"sec-fetch-dest":destination}), response=response))
            self.assertEqual((response.text, dict(response.headers)), before)

if __name__ == "__main__":
    unittest.main()
