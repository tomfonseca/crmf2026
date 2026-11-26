package config

import (
	"errors"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

type Auth struct {
	Enabled, Development                                             bool
	DatabaseURL, KeyFile, KeyVaultSecretURL, ManagedIdentityClientID string
	TenantOrigin, PlatformOrigin                                     string
	RecoveryMailpitURL                                               string
	TrustedProxies                                                   []netip.Prefix
}

func LoadAuth(lookup func(string) string) (Auth, error) {
	a := Auth{Development: lookup("APP_ENV") == "development"}
	enabled := lookup("AUTH_ENABLED")
	if enabled != "" && enabled != "true" && enabled != "false" {
		return Auth{}, errors.New("invalid AUTH_ENABLED")
	}
	a.Enabled = enabled == "true"
	if !a.Enabled {
		return a, nil
	}
	a.DatabaseURL = lookup("AUTH_DATABASE_URL")
	a.KeyFile = lookup("AUTH_KEY_FILE")
	a.KeyVaultSecretURL = lookup("AUTH_KEYVAULT_SECRET_URL")
	a.ManagedIdentityClientID = lookup("AZURE_CLIENT_ID")
	a.TenantOrigin = lookup("AUTH_TENANT_ORIGIN")
	a.PlatformOrigin = lookup("AUTH_PLATFORM_ORIGIN")
	u, err := url.Parse(a.DatabaseURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		return Auth{}, errors.New("invalid auth database configuration")
	}
	if (a.KeyFile == "") == (a.KeyVaultSecretURL == "") || (a.KeyFile != "" && !a.Development) {
		return Auth{}, errors.New("auth requires exactly one key source; files are development-only")
	}
	if a.KeyVaultSecretURL != "" {
		if _, _, _, err := ParseVaultReference(a.KeyVaultSecretURL); err != nil {
			return Auth{}, err
		}
	}
	if !ValidOrigin(a.TenantOrigin, a.Development) || !ValidOrigin(a.PlatformOrigin, a.Development) || a.TenantOrigin == a.PlatformOrigin {
		return Auth{}, errors.New("invalid realm-specific frontend origins")
	}
	if raw := lookup("AUTH_TRUSTED_PROXIES"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			p, err := netip.ParsePrefix(strings.TrimSpace(part))
			if err != nil || p.Bits() == 0 || len(a.TrustedProxies) >= 16 {
				return Auth{}, errors.New("invalid trusted proxy prefixes")
			}
			a.TrustedProxies = append(a.TrustedProxies, p.Masked())
		}
	}
	a.RecoveryMailpitURL = lookup("AUTH_RECOVERY_MAILPIT_URL")
	if a.RecoveryMailpitURL != "" && !a.Development {
		return Auth{}, errors.New("local recovery is development-only; production provider is not configured")
	}
	return a, nil
}
func ValidOrigin(raw string, development bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.Host != strings.ToLower(u.Host) || strings.ContainsAny(raw, "\r\n?#") {
		return false
	}
	if port := u.Port(); port != "" {
		if n, err := strconv.ParseUint(port, 10, 16); err != nil || n == 0 {
			return false
		}
	}
	if u.Scheme == "https" {
		return true
	}
	return development && u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")
}

// ParseVaultReference accepts only an immutable secret version in Azure public cloud.
func ParseVaultReference(raw string) (vault, name, version string, err error) {
	bad := errors.New("invalid version-pinned Key Vault secret reference")
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || u.Host != strings.ToLower(u.Host) || !strings.HasSuffix(u.Host, ".vault.azure.net") {
		return "", "", "", bad
	}
	host := strings.TrimSuffix(u.Host, ".vault.azure.net")
	if len(host) < 3 || len(host) > 24 || strings.Contains(host, ".") || strings.Trim(host, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
		return "", "", "", bad
	}
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "secrets" || parts[1] == "" || len(parts[1]) > 127 || strings.Trim(parts[1], "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-") != "" || len(parts[2]) != 32 || strings.Trim(parts[2], "0123456789abcdefABCDEF") != "" {
		return "", "", "", bad
	}
	return "https://" + u.Host, parts[1], parts[2], nil
}
