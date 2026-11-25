package auth

import (
	"bytes"
	"github.com/google/uuid"
	"testing"
)

func TestMFAEncryptionBinding(t *testing.T) {
	cipher, err := newSecretCipher(bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	secret := "synthetic authentication state"
	first, err := sealSecret(cipher, user, "enroll", secret)
	if err != nil {
		t.Fatal(err)
	}
	second, err := sealSecret(cipher, user, "enroll", secret)
	if err != nil || bytes.Equal(first, second) {
		t.Fatal("nonce reused")
	}
	value, err := openSecret(cipher, user, "enroll", first)
	if err != nil || value != secret {
		t.Fatal("decrypt failed")
	}
	if _, err := openSecret(cipher, uuid.New(), "enroll", first); err == nil {
		t.Fatal("cross-user ciphertext accepted")
	}
	if _, err := openSecret(cipher, user, "mfa", first); err == nil {
		t.Fatal("cross-purpose ciphertext accepted")
	}
	first[len(first)-1] ^= 1
	if _, err := openSecret(cipher, user, "enroll", first); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
	if _, err := newSecretCipher(nil); err == nil {
		t.Fatal("missing key accepted")
	}
}
func TestPasskeyOriginsFailClosed(t *testing.T) {
	for _, origins := range [][2]string{{"http://127.0.0.1:5174", "http://localhost:5173"}, {"https://[::1]", "https://hq.example.com"}, {"", ""}, {"http://example.com", "https://hq.example.com"}, {"https://app.example.com/path", "https://hq.example.com"}, {"https://same.example.com", "https://same.example.com"}} {
		if _, err := passkeyProviders(origins[0], origins[1]); err == nil {
			t.Fatal("invalid RP origins accepted")
		}
	}
	providers, err := passkeyProviders("https://app.example.com", "https://hq.example.com")
	if err != nil || providers[Tenant].Config.RPID != "app.example.com" || providers[Platform].Config.RPID != "hq.example.com" {
		t.Fatal("RP realm isolation")
	}
}
