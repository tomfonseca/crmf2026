package auth

import (
	"bytes"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestMFAEncryptionBinding(t *testing.T) {
	cipher, err := newSecretCipher(bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	secret := "synthetic TOTP secret"
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
func TestTOTPRFC6238(t *testing.T) {
	step, ok := totpStep("287082", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", time.Unix(59, 0))
	if !ok || step != 1 {
		t.Fatal("RFC 6238 SHA-1 vector failed")
	}
	if _, ok := totpStep(" 287082", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", time.Unix(59, 0)); ok {
		t.Fatal("noncanonical code accepted")
	}
}
