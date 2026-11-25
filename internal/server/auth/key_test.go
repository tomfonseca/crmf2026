package auth

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azsecrets"
	"github.com/crmf/crmf/internal/server/config"
)

type keyTransport func(*http.Request) (*http.Response, error)

func (f keyTransport) Do(r *http.Request) (*http.Response, error) { return f(r) }

type keyCredential struct{}

func (keyCredential) GetToken(context.Context, policy.TokenRequestOptions) (azcore.AccessToken, error) {
	return azcore.AccessToken{Token: "synthetic", ExpiresOn: time.Now().Add(time.Hour)}, nil
}
func TestDevelopmentKeyProvider(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	value := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if err := os.WriteFile(path, []byte(value+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Auth{Development: true, KeyFile: path}
	if key, err := LoadMFAKey(context.Background(), cfg); err != nil || len(key) != 32 {
		t.Fatal("development key failed")
	}
	cfg.Development = false
	if _, err := LoadMFAKey(context.Background(), cfg); err == nil {
		t.Fatal("production file key accepted")
	}
	if _, err := decodeMFAKey("secret-invalid-value"); err == nil || strings.Contains(err.Error(), "secret-invalid-value") {
		t.Fatal("key error leaked input")
	}
}
func TestKeyVaultProviderPinsVersion(t *testing.T) {
	reference := "https://testvault.vault.azure.net/secrets/mfa/0123456789abcdef0123456789abcdef"
	called := false
	transport := keyTransport(func(r *http.Request) (*http.Response, error) {
		called = true
		if r.URL.Scheme != "https" || r.URL.Host != "testvault.vault.azure.net" || r.URL.Path != "/secrets/mfa/0123456789abcdef0123456789abcdef" {
			t.Fatal("unexpected Key Vault target")
		}
		body := `{"value":"` + base64.StdEncoding.EncodeToString(make([]byte, 32)) + `","attributes":{"enabled":true}}`
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	key, err := loadVaultKey(context.Background(), reference, keyCredential{}, &azsecrets.ClientOptions{ClientOptions: azcore.ClientOptions{Transport: transport}})
	if err != nil || len(key) != 32 || !called {
		t.Fatal("version-pinned Key Vault load failed")
	}
}
