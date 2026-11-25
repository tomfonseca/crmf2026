package auth

import (
	"encoding/json"
	"github.com/crmf/crmf/internal/testpasskey"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"testing"
)

func TestPasskeySyntheticProtocolRoundtrip(t *testing.T) {
	providers, err := passkeyProviders("http://localhost:5174", "http://localhost:5173")
	if err != nil {
		t.Fatal(err)
	}
	user := passkeyUser{id: uuid.New(), realm: Tenant}
	creation, state, err := providers[Tenant].BeginRegistration(user, webauthn.WithExtensions(webauthn.WithExtensionCredProps()))
	if err != nil {
		t.Fatal(err)
	}
	options, _ := json.Marshal(creation.Response)
	device := testpasskey.New(t)
	response := device.Register(t, options, "http://localhost:5174")
	parsed, err := protocol.ParseCredentialCreationResponseBytes([]byte(response))
	if err != nil {
		t.Fatalf("parse synthetic registration: %#v", err)
	}
	key, err := providers[Tenant].CreateCredential(user, *state, parsed)
	if err != nil {
		t.Fatalf("verify synthetic registration: %#v", err)
	}
	user.credentials = append(user.credentials, *key)
	assertion, state, err := providers[Tenant].BeginLogin(user)
	if err != nil {
		t.Fatal(err)
	}
	options, _ = json.Marshal(assertion.Response)
	parsedAssertion, err := protocol.ParseCredentialRequestResponseBytes([]byte(device.Authenticate(t, options, "http://localhost:5174")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := providers[Tenant].ValidateLogin(user, *state, parsedAssertion); err != nil {
		t.Fatalf("verify synthetic assertion: %#v", err)
	}
}
