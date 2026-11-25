package httpapi

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func sourceIP(r *http.Request, trusted []netip.Prefix) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}, errors.New("invalid peer")
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || peer.Zone() != "" {
		return netip.Addr{}, errors.New("invalid peer")
	}
	peer = peer.Unmap()
	isTrusted := func(ip netip.Addr) bool {
		for _, p := range trusted {
			if p.Contains(ip) {
				return true
			}
		}
		return false
	}
	if !isTrusted(peer) {
		return peer, nil
	}
	values := r.Header.Values("X-Forwarded-For")
	if len(values) != 1 || len(values[0]) > 1024 {
		return netip.Addr{}, errors.New("missing or ambiguous proxy chain")
	}
	parts := strings.Split(values[0], ",")
	if len(parts) > 8 {
		return netip.Addr{}, errors.New("proxy chain too long")
	}
	for i := len(parts) - 1; i >= 0 && isTrusted(peer); i-- {
		raw := strings.TrimSpace(parts[i])
		candidate, err := netip.ParseAddr(raw)
		if err != nil {
			address, e := netip.ParseAddrPort(raw)
			if e != nil {
				return netip.Addr{}, errors.New("invalid proxy chain")
			}
			candidate = address.Addr()
		}
		if candidate.Zone() != "" {
			return netip.Addr{}, errors.New("invalid proxy chain")
		}
		peer = candidate.Unmap()
	}
	return peer, nil
}
