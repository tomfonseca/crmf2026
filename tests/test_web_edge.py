"""Black-box smoke contract for the separately started production web-edge image.

CRMF_WEB_EDGE_URL must point at a loopback HTTP staging listener, never a real API.
"""
import http.client
import json
import os
import re
import unittest
from urllib.parse import urlsplit


@unittest.skipUnless(os.getenv("CRMF_WEB_EDGE_URL"), "production edge container not requested")
class WebEdgeTests(unittest.TestCase):
    def request(self, host, path="/", method="GET", origin=None):
        base = urlsplit(os.environ["CRMF_WEB_EDGE_URL"])
        self.assertEqual(base.scheme, "http")
        self.assertIn(base.hostname, ("127.0.0.1", "localhost"))
        conn = http.client.HTTPConnection(base.hostname, base.port, timeout=5)
        self.addCleanup(conn.close)
        headers = {"Host": host}
        if origin:
            headers["Origin"] = origin
        conn.request(method, path, headers=headers)
        response = conn.getresponse()
        return response.status, dict((k.lower(), v) for k, v in response.getheaders()), response.read()

    def test_real_compiled_spa_and_hashed_assets(self):
        for host, path in (("qg.crmfarma.app.br", "/"), ("qg.crmfarma.app.br", "/stores/example/pairing"),
                           ("dash.crmfarma.app.br", "/login"), ("dash.crmfarma.app.br", "/login/minha-conta")):
            with self.subTest(host=host, path=path):
                status, headers, body = self.request(host, path)
                self.assertEqual(status, 200)
                self.assertIn(b'id="root"', body)
                self.assertEqual(headers["cache-control"], "no-store")
                self.assertEqual(headers["x-content-type-options"], "nosniff")
                self.assertEqual(headers["x-frame-options"], "DENY")
                self.assertIn("connect-src https://api.crmfarma.app.br", headers["content-security-policy"])
                asset = re.search(rb'src="(/assets/[^"]+\.js)"', body)
                self.assertIsNotNone(asset)
                code, cache, js = self.request(host, asset.group(1).decode())
                self.assertEqual(code, 200)
                self.assertIn("immutable", cache["cache-control"])
                self.assertIn(b"https://api.crmfarma.app.br", js)
                for private in (b"/__qg-design", b"/__auth-design", b"/@vite/client", b"http://localhost:8080"):
                    self.assertNotIn(private, js)

    def test_private_dev_and_source_paths_are_not_spa_fallbacks(self):
        for host in ("qg.crmfarma.app.br", "dash.crmfarma.app.br"):
            for path in ("/.env", "/.git/config", "/__qg-design", "/__auth-design",
                         "/src/main.tsx", "/node_modules/react/package.json", "/@vite/client"):
                with self.subTest(host=host, path=path):
                    self.assertEqual(self.request(host, path)[0], 404)
        self.assertEqual(self.request("qg.crmfarma.app.br", "/assets/missing.js")[0], 404)

    def test_synthetic_dashboard_is_not_public_business_data(self):
        status, headers, _ = self.request("dash.crmfarma.app.br")
        self.assertEqual(status, 302)
        self.assertEqual(headers["location"], "/login")
        for path in ("/meu-desempenho", "/minhas-metas", "/other"):
            self.assertEqual(self.request("dash.crmfarma.app.br", path)[0], 503)

    def test_all_api_routes_fail_closed_without_inventing_auth_or_readiness(self):
        for path in ("/healthz", "/readyz", "/v1/hq/me", "/v1/me", "/v1/hq/plans", "/v1/hq/tenants"):
            for method in ("GET", "POST", "PUT", "DELETE", "OPTIONS"):
                with self.subTest(path=path, method=method):
                    status, headers, body = self.request("api.crmfarma.app.br", path, method)
                    self.assertEqual(status, 503)
                    self.assertEqual(headers["content-type"], "application/problem+json")
                    self.assertEqual(headers["cache-control"], "no-store")
                    self.assertNotIn("set-cookie", headers)
                    self.assertEqual(json.loads(body)["type"], "deployment_pending")

    def test_cors_is_exact_and_never_wildcard(self):
        for origin in ("https://qg.crmfarma.app.br", "https://dash.crmfarma.app.br",
                       "https://evil.example", "https://qg.crmfarma.app.br.evil.example",
                       "http://qg.crmfarma.app.br"):
            _, headers, _ = self.request("api.crmfarma.app.br", "/v1/me", origin=origin)
            if origin in ("https://qg.crmfarma.app.br", "https://dash.crmfarma.app.br"):
                self.assertEqual(headers.get("access-control-allow-origin"), origin)
                self.assertEqual(headers.get("access-control-allow-credentials"), "true")
            else:
                self.assertNotIn("access-control-allow-origin", headers)

    def test_unrecognized_host_has_no_site_or_health_disclosure(self):
        for path in ("/", "/healthz", "/srv/qg/index.html"):
            status, _, body = self.request("unrecognized.example", path)
            self.assertNotEqual(status, 200)
            self.assertNotIn(b'id="root"', body)
            self.assertNotIn(b"web_edge_only", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
