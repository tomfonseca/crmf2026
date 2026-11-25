package tenancy

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azsecrets"
	"github.com/google/uuid"
)

type tenantVaultToken struct{}

func (tenantVaultToken) GetToken(context.Context, policy.TokenRequestOptions) (azcore.AccessToken, error) {
	return azcore.AccessToken{Token: "synthetic-token", ExpiresOn: time.Now().Add(time.Hour)}, nil
}

type tenantVaultTransport func(*http.Request) (*http.Response, error)

func (f tenantVaultTransport) Do(r *http.Request) (*http.Response, error) { return f(r) }
func testTenantVault(t *testing.T, transport tenantVaultTransport) *Vault {
	t.Helper()
	client, err := azsecrets.NewClient("https://synthetic.vault.azure.net", tenantVaultToken{}, &azsecrets.ClientOptions{ClientOptions: azcore.ClientOptions{Transport: transport, Retry: policy.RetryOptions{MaxRetries: -1}}})
	if err != nil {
		t.Fatal(err)
	}
	return &Vault{client: client}
}
func tenantVaultResponse(r *http.Request, status int, body any) *http.Response {
	raw, _ := json.Marshal(body)
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Request: r, Body: io.NopCloser(strings.NewReader(string(raw)))}
}
func TestTenantVaultPinnedOwnershipAndFailures(t *testing.T) {
	id := uuid.New()
	secret, _ := newCredential(id)
	version := strings.Repeat("a", 32)
	body := func(owner uuid.UUID, enabled bool) map[string]any {
		return map[string]any{"value": secret.Password, "id": "https://synthetic.vault.azure.net/secrets/pg-tenant-synthetic/" + version, "tags": map[string]string{"crmf-tenant-id": owner.String()}, "attributes": map[string]bool{"enabled": enabled}}
	}
	for _, test := range []struct {
		name   string
		status int
		body   any
		want   error
	}{
		{"valid", 200, body(id, true), nil},
		{"disabled", 200, body(id, false), ErrUnavailable},
		{"wrong tenant", 200, body(uuid.New(), true), ErrConflict},
		{"missing", 404, map[string]any{"error": map[string]string{"code": "SecretNotFound"}}, ErrCredentialMissing},
		{"permission", 403, map[string]any{"error": map[string]string{"code": "Forbidden"}}, ErrUnavailable},
		{"outage", 503, map[string]any{"error": map[string]string{"code": "Unavailable"}}, ErrUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			vault := testTenantVault(t, func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" || !strings.Contains(r.URL.Path, version) {
					t.Error("not a pinned GET")
				}
				return tenantVaultResponse(r, test.status, test.body), nil
			})
			value, err := vault.Get(context.Background(), id, "synthetic", version)
			if !errors.Is(err, test.want) {
				t.Fatal("unexpected credential result", err)
			}
			if err == nil && (value.Password != secret.Password || value.Version != version) {
				t.Fatal("credential changed")
			}
		})
	}
}
func TestTenantVaultCreationNeverOverwritesKnownSecret(t *testing.T) {
	id := uuid.New()
	version := strings.Repeat("b", 32)
	sets := 0
	exists := false
	vault := testTenantVault(t, func(r *http.Request) (*http.Response, error) {
		if r.Method == "GET" {
			if !exists {
				return tenantVaultResponse(r, 404, map[string]any{"error": map[string]string{"code": "SecretNotFound"}}), nil
			}
			credential, _ := newCredential(id)
			return tenantVaultResponse(r, 200, map[string]any{"value": credential.Password, "id": "https://synthetic.vault.azure.net/secrets/pg-tenant-synthetic/" + version, "tags": map[string]string{"crmf-tenant-id": id.String()}}), nil
		}
		if r.Method != "PUT" {
			t.Error("unexpected mutation method")
		}
		// Key Vault SDK deliberately removes a first PUT body until it learns
		// the vault's authentication challenge. Emulate that real protocol.
		if r.Body == nil {
			response := tenantVaultResponse(r, 401, map[string]any{"error": map[string]string{"code": "Unauthorized"}})
			response.Header.Set("WWW-Authenticate", `Bearer authorization="https://login.windows.net/00000000-0000-0000-0000-000000000000", resource="https://vault.azure.net"`)
			return response, nil
		}
		sets++
		var payload map[string]any
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("bad set payload")
		}
		return tenantVaultResponse(r, 200, map[string]any{"value": payload["value"], "id": "https://synthetic.vault.azure.net/secrets/pg-tenant-synthetic/" + version}), nil
	})
	value, err := vault.Create(context.Background(), id, "synthetic")
	if err != nil || value.Version != version || sets != 1 {
		t.Fatal("create failed", err)
	}
	exists = true
	if _, err := vault.Create(context.Background(), id, "synthetic"); !errors.Is(err, ErrConflict) || sets != 1 {
		t.Fatal("existing secret overwritten")
	}
}
