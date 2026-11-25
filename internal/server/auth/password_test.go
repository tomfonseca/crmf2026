package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func TestPasswordPolicy(t *testing.T) {
	p, err := NewPasswords()
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"short", "123456789012", "", strings.Repeat("x", 1025), string([]byte{0xff})} {
		if !errors.Is(p.Validate(value), ErrPasswordPolicy) {
			t.Fatal("unsafe password accepted")
		}
	}
	if err := p.Validate("A unique synthetic passphrase! 2026"); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(commonPasswords)
	if hex.EncodeToString(sum[:]) != "c112bfdbe7374ab297e61f2f12019ac0ae7f23bffbc010eca5171a7a34e983be" {
		t.Fatal("denylist differs from pinned source")
	}
}

func TestPasswordHashAndVerify(t *testing.T) {
	p, err := NewPasswords()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	password := "A unique synthetic passphrase! 2026"
	first, err := p.Hash(ctx, password)
	if err != nil {
		t.Fatal(err)
	}
	second, err := p.Hash(ctx, password)
	if err != nil {
		t.Fatal(err)
	}
	if first == second || !strings.HasPrefix(first, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatal("salt or PHC parameters incorrect")
	}
	match, err := p.Verify(ctx, password, first)
	if err != nil || !match.Valid || match.NeedsRehash {
		t.Fatal("valid password rejected")
	}
	match, err = p.Verify(ctx, "A different synthetic passphrase", first)
	if err != nil || match.Valid {
		t.Fatal("wrong password accepted")
	}
	for _, hash := range []string{"", "$argon2id$v=19$m=4294967295,t=3,p=2$bad$bad", strings.Replace(first, "p=2", "p=0", 1), strings.Replace(first, "v=19", "v=16", 1)} {
		if _, err := p.Verify(ctx, password, hash); !errors.Is(err, ErrInvalidHash) {
			t.Fatal("malformed or excessive hash accepted")
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := p.Hash(cancelled, password); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation ignored")
	}
}

func TestOpaqueTokens(t *testing.T) {
	a, hash, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	got, err := tokenHash(a)
	if err != nil || len(a) != 43 || len(hash) != 32 || a == b || string(got) != string(hash) || strings.Contains(a, string(hash)) {
		t.Fatal("unsafe token")
	}
	for _, bad := range []string{"", "short", a + "=", strings.Repeat("!", 43), a[:42] + "_"} {
		if _, err := tokenHash(bad); !errors.Is(err, ErrUnauthenticated) {
			t.Fatal("noncanonical token accepted")
		}
	}
}
