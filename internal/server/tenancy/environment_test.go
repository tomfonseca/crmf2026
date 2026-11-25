package tenancy

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestCredentialEnvironmentNeverFallsBack(t *testing.T) {
	for _, values := range []map[string]string{
		{}, {"APP_ENV": "development", "TENANT_KEYVAULT_URL": "https://example.vault.azure.net", "TENANT_CREDENTIALS_DIR": filepath.Join(t.TempDir(), "credentials")},
		{"APP_ENV": "production", "TENANT_CREDENTIALS_DIR": filepath.Join(t.TempDir(), "credentials")},
		{"APP_ENV": "production", "TENANT_KEYVAULT_URL": "http://untrusted.invalid"},
	} {
		if _, err := CredentialsFromEnvironment(func(key string) string { return values[key] }); err == nil {
			t.Fatal("ambiguous or unsafe custody accepted")
		}
	}
	values := map[string]string{"APP_ENV": "development", "TENANT_CREDENTIALS_DIR": filepath.Join(t.TempDir(), "credentials")}
	if _, err := CredentialsFromEnvironment(func(key string) string { return values[key] }); err != nil {
		t.Fatal("explicit development custody", err)
	}
	if _, err := CredentialsFromEnvironment(func(string) string { return "" }); !errors.Is(err, ErrInvalid) {
		t.Fatal("missing custody", err)
	}
}
