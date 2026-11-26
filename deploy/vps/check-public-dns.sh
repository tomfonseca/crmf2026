#!/usr/bin/env bash
# Run on the homologation VPS before enabling public listeners/ACME.
set -euo pipefail
command -v dig >/dev/null || { echo "dig is required" >&2; exit 1; }
failed=0
for resolver in 1.1.1.1 8.8.8.8; do
  for host in qg.crmfarma.app.br dash.crmfarma.app.br api.crmfarma.app.br; do
    addresses="$(dig @"$resolver" "$host" A +time=3 +tries=1 +short)"
    ipv6="$(dig @"$resolver" "$host" AAAA +time=3 +tries=1 +short)"
    if [[ "$addresses" != "108.174.144.89" || -n "$ipv6" ]]; then
      printf 'BLOCKED: %s via %s must resolve only A=108.174.144.89 and no AAAA\n' "$host" "$resolver" >&2
      failed=1
    else
      printf 'DNS_OK: %s via %s\n' "$host" "$resolver"
    fi
  done
done
if [[ "$failed" != 0 ]]; then
  echo "Keep loopback staging. Do not request public certificates yet." >&2
  exit 1
fi
echo "DNS_GATE_PASSED"
