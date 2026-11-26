#!/usr/bin/env bash
# Run on the homologation VPS before enabling public listeners/ACME.
set -euo pipefail
command -v dig >/dev/null || { echo "dig is required" >&2; exit 1; }
# dig +short hides SERVFAIL/REFUSED and can exit zero on DNS errors. An empty
# AAAA answer is safe here only after an explicit successful NOERROR response.
check_record() {
  local resolver="$1" host="$2" kind="$3" reply status=unavailable
  local owner ttl class record value extra count=0
  if ! reply="$(dig @"$resolver" "$host" "$kind" +time=3 +tries=1 +noall +comments +answer)"; then
    printf 'BLOCKED: %s %s via %s: DNS transport failed\n' "$host" "$kind" "$resolver" >&2
    return 1
  fi
  if [[ "$reply" == *';; ->>HEADER<<-'* && "$reply" =~ status:\ ([A-Z]+), ]]; then
    status="${BASH_REMATCH[1]}"
  fi
  if [[ "$status" != NOERROR ]]; then
    printf 'BLOCKED: %s %s via %s: DNS status %s\n' "$host" "$kind" "$resolver" "$status" >&2
    return 1
  fi
  while read -r owner ttl class record value extra; do
    [[ -z "$owner" || "$owner" == ';'* ]] && continue
    if [[ "${owner,,}" != "$host." || ! "$ttl" =~ ^[0-9]+$ || "$class" != IN || "$record" != "$kind" || -z "$value" || -n "$extra" ]]; then
      printf 'BLOCKED: %s %s via %s: unexpected answer (aliases are not accepted)\n' "$host" "$kind" "$resolver" >&2
      return 1
    fi
    if [[ "$kind" != A || "$value" != 108.174.144.89 ]]; then
      printf 'BLOCKED: %s %s via %s: must have only A=108.174.144.89 and no AAAA\n' "$host" "$kind" "$resolver" >&2
      return 1
    fi
    ((count += 1))
  done <<< "$reply"
  if [[ "$kind" == A && "$count" != 1 ]]; then
    printf 'BLOCKED: %s via %s: exactly one A=108.174.144.89 is required\n' "$host" "$resolver" >&2
    return 1
  fi
  return 0
}
failed=0
for resolver in 1.1.1.1 8.8.8.8; do
  for host in qg.crmfarma.app.br dash.crmfarma.app.br api.crmfarma.app.br; do
    if check_record "$resolver" "$host" A && check_record "$resolver" "$host" AAAA; then
      printf 'DNS_OK: %s via %s\n' "$host" "$resolver"
    else
      failed=1
    fi
  done
done
if [[ "$failed" != 0 ]]; then
  echo "Keep loopback staging. Do not request public certificates yet." >&2
  exit 1
fi
echo "DNS_GATE_PASSED"
