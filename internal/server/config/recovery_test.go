package config

import (
	"strings"
	"testing"
)

func TestProductionRecoveryCaptureCannotBeEnabled(t *testing.T) {
	env := map[string]string{
		"AUTH_ENABLED": "true", "APP_ENV": "production",
		"AUTH_DATABASE_URL":        "postgres://crmf_auth:test@localhost/control",
		"AUTH_KEYVAULT_SECRET_URL": "https://testvault.vault.azure.net/secrets/mfa/0123456789abcdef0123456789abcdef",
		"AUTH_TENANT_ORIGIN":       "https://dash.example.test", "AUTH_PLATFORM_ORIGIN": "https://qg.example.test",
		"AUTH_RECOVERY_MAILPIT_URL": "http://mailpit:8025",
	}
	if _, err := LoadAuth(func(k string) string { return env[k] }); err == nil || !strings.Contains(err.Error(), "development-only") {
		t.Fatal("capture accepted with production custody")
	}
}
