"""Opt-in acceptance for the public homologation web edge, not a live backend.

CRMF_PUBLIC_HTTPS_TEST=1 enables requests only to the three fixed CRMF hosts.
No cookies, bearer credentials or TLS-verification bypass. These checks expect
maintenance 503; do not use them as authenticated backend acceptance.
"""
import http.client
import json
import os
import socket
import ssl
import unittest

import test_web_edge as edge


class PublicHTTPS(edge.WebEdgeTests):
    # Explicitly override the inherited loopback-only skip. Default discovery
    # stays offline; enabling public checks never enables loopback checks.
    __unittest_skip__ = os.getenv("CRMF_PUBLIC_HTTPS_TEST") != "1"
    __unittest_skip_why__ = "public homologation acceptance not requested"

    def request(self, host, path="/", method="GET", origin=None):
        allowed = {"qg.crmfarma.app.br", "dash.crmfarma.app.br", "api.crmfarma.app.br"}
        if host == "unrecognized.example":
            # Preserve the base HTTP unknown-Host contract. Unknown HTTPS SNI
            # is tested independently with verification enabled below.
            conn = http.client.HTTPConnection("108.174.144.89", timeout=8)
        else:
            self.assertIn(host, allowed)
            conn = http.client.HTTPSConnection(host, timeout=8, context=ssl.create_default_context())
        self.addCleanup(conn.close)
        headers = {"Host": host}
        if origin:
            headers["Origin"] = origin
        conn.request(method, path, headers=headers)
        response = conn.getresponse()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()

    def test_public_certificate_chain_hostname_and_redirects(self):
        for host in ("qg.crmfarma.app.br", "dash.crmfarma.app.br", "api.crmfarma.app.br"):
            with self.subTest(host=host):
                with socket.create_connection((host, 443), timeout=8) as raw:
                    with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as secure:
                        cert = secure.getpeercert()
                        self.assertIn(("DNS", host), cert["subjectAltName"])
                        self.assertIn(secure.version(), ("TLSv1.2", "TLSv1.3"))
                        print(json.dumps({"host": host, "chainAndHostnameVerified": True,
                                          "protocol": secure.version(), "expires": cert["notAfter"]}))
                conn = http.client.HTTPConnection(host, timeout=8)
                self.addCleanup(conn.close)
                conn.request("GET", "/")
                response = conn.getresponse()
                response.read()
                self.assertEqual(response.status, 308)
                self.assertEqual(response.getheader("location"), "https://" + host + "/")

    def test_unknown_sni_does_not_obtain_a_site(self):
        with socket.create_connection(("108.174.144.89", 443), timeout=8) as raw:
            with self.assertRaises(ssl.SSLError):
                with ssl.create_default_context().wrap_socket(raw, server_hostname="unrecognized.example"):
                    self.fail("unrecognized SNI accepted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
