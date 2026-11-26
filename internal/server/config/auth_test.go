package config

import "testing"

func TestAuthConfigurationFailsClosed(t *testing.T) {
	base := map[string]string{"AUTH_ENABLED": "true", "APP_ENV": "development", "AUTH_DATABASE_URL": "postgres://crmf_auth:test@localhost/control", "AUTH_KEY_FILE": "/private/mfa.key", "AUTH_TENANT_ORIGIN": "http://localhost:5174", "AUTH_PLATFORM_ORIGIN": "http://localhost:5173"}
	load := func() (Auth, error) { return LoadAuth(func(k string) string { return base[k] }) }
	if _, err := load(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"AUTH_DATABASE_URL", "AUTH_KEY_FILE", "AUTH_TENANT_ORIGIN", "AUTH_PLATFORM_ORIGIN"} {
		old := base[name]
		base[name] = ""
		if _, err := load(); err == nil {
			t.Fatal("missing auth configuration accepted")
		}
		base[name] = old
	}
	base["APP_ENV"] = "production"
	if _, err := load(); err == nil {
		t.Fatal("production file key accepted")
	}
	for _, origin := range []string{"*", "null", "https://user:password@example.test", "https://example.test/path", "https://example.test?secret", "https://:443", "https://example.test:99999", "http://external.test"} {
		if ValidOrigin(origin, true) {
			t.Fatal("unsafe origin accepted")
		}
	}
	if _, _, _, err := ParseVaultReference("https://testvault.vault.azure.net/secrets/mfa"); err == nil {
		t.Fatal("unversioned secret accepted")
	}
	if _, _, _, err := ParseVaultReference("https://testvault.vault.azure.net/secrets/mfa/0123456789abcdef0123456789abcdef"); err != nil {
		t.Fatal(err)
	}
}
