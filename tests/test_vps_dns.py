"""Offline regression tests for the VPS DNS publication gate (no network)."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "deploy/vps/check-public-dns.sh"
BASH = shutil.which("bash")
FAKE_DIG = r'''
dig() {
  local kind="$3" status=NOERROR records="" short="" answer=""
  [[ "$*" == *"+short"* ]] && short=1
  if [[ "$kind" == A ]]; then
    records=108.174.144.89
    answer="$2. 300 IN A $records"
    case "$DNS_CASE" in
      wrong_a) records=192.0.2.1; answer="$2. 300 IN A $records";;
      missing_a) records=""; answer="";;
      nxdomain) records=""; answer=""; status=NXDOMAIN;;
      multi_a) records=$'108.174.144.89\n192.0.2.1'; answer="$answer"$'\n'"$2. 300 IN A 192.0.2.1";;
      cname) records=$'other.example.\n108.174.144.89'; answer="$2. 300 IN CNAME other.example."$'\n'"other.example. 300 IN A 108.174.144.89";;
    esac
  else
    case "$DNS_CASE" in
      servfail_aaaa) status=SERVFAIL;;
      refused_aaaa) status=REFUSED;;
      nxdomain_aaaa) status=NXDOMAIN;;
      ipv6) records=2001:db8::1; answer="$2. 300 IN AAAA $records";;
      timeout_aaaa) return 9;;
      missing_header) return 0;;
      cloudflare_error) [[ "$1" == @1.1.1.1 ]] && status=SERVFAIL;;
      google_error) [[ "$1" == @8.8.8.8 ]] && status=SERVFAIL;;
    esac
  fi
  if [[ -z "$short" ]]; then
    printf ';; ->>HEADER<<- opcode: QUERY, status: %s, id: 42\n' "$status"
    printf ';; flags: qr rd ra; QUERY: 1, ANSWER: 0\n'
    [[ -n "$answer" ]] && printf '%s\n' "$answer"
  elif [[ -n "$records" ]]; then
    printf '%s\n' "$records"
  fi
  return 0
}
export -f dig
source "$1"
'''


@unittest.skipUnless(BASH, "bash is required for the operational script")
class VPSDNSGateTests(unittest.TestCase):
    def run_case(self, case):
        return subprocess.run(
            [BASH, "-c", FAKE_DIG, "dns-test", SCRIPT.as_posix()],
            env={**os.environ, "DNS_CASE": case},
            text=True, capture_output=True, check=False, timeout=10,
        )

    def test_exact_ipv4_and_successful_empty_aaaa_pass(self):
        result = self.run_case("valid")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("DNS_OK:"), 6)
        self.assertIn("DNS_GATE_PASSED", result.stdout)

    def test_dns_error_is_not_absent_ipv6(self):
        for case in ("servfail_aaaa", "refused_aaaa", "nxdomain_aaaa",
                     "timeout_aaaa", "missing_header"):
            with self.subTest(case=case):
                result = self.run_case(case)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn("DNS_GATE_PASSED", result.stdout)

    def test_each_resolver_is_required(self):
        for case in ("cloudflare_error", "google_error"):
            with self.subTest(case=case):
                result = self.run_case(case)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn("DNS_GATE_PASSED", result.stdout)
                self.assertIn("DNS status SERVFAIL", result.stderr)

    def test_missing_wrong_aliased_or_multiple_records_block(self):
        for case in ("wrong_a", "missing_a", "nxdomain", "multi_a",
                     "cname", "ipv6"):
            with self.subTest(case=case):
                result = self.run_case(case)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertNotIn("DNS_GATE_PASSED", result.stdout)


if __name__ == "__main__":
    unittest.main()
