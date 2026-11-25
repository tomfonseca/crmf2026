package auth

import (
	"context"
	"encoding/base64"
	"fmt"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestLegacyPasswordRehash(t *testing.T) {
	passwords, err := NewPasswords()
	if err != nil {
		t.Fatal(err)
	}
	salt := []byte("synthetic-salt16!")
	password := "A unique synthetic passphrase! 2026"
	key := argon2.IDKey([]byte(password), salt, 1, 8192, 1, 32)
	encoded := fmt.Sprintf("$argon2id$v=19$m=8192,t=1,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
	result, err := passwords.Verify(context.Background(), password, encoded)
	if err != nil || !result.Valid || !result.NeedsRehash {
		t.Fatal("valid legacy hash must request rehash")
	}
}
