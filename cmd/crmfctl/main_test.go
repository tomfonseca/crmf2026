package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
)

func TestCLIRejectsSecretArguments(t *testing.T) {
	for _, args := range [][]string{
		{"user", "create-admin", "--email", "fixture@example.invalid", "--name", "Fixture", "--password=do-not-echo-this"},
		{"user", "create-admin", "--db-url=postgres://do-not-echo-this"},
		{"user", "create-admin", "--email", "invalid", "--name", "Fixture"},
	} {
		var out bytes.Buffer
		called := false
		c := cli{out: &out, lookup: func(string) string { return "postgres://do-not-echo-this" }, readSecret: func(context.Context, string) ([]byte, error) { called = true; return nil, nil }}
		err := c.run(context.Background(), args)
		if err == nil || called || strings.Contains(err.Error()+out.String(), "do-not-echo-this") {
			t.Fatal("unsafe CLI input handling")
		}
	}
}
func TestCLICreatesOnlyAfterMatchingSecretInput(t *testing.T) {
	var out bytes.Buffer
	password := []byte("A unique synthetic bootstrap passphrase! 2026")
	confirmation := bytes.Clone(password)
	calls := 0
	created := false
	id := uuid.New()
	c := cli{out: &out, lookup: func(string) string { return "synthetic-private-connection" },
		readSecret: func(context.Context, string) ([]byte, error) {
			calls++
			if calls == 1 {
				return password, nil
			}
			return confirmation, nil
		},
		create: func(ctx context.Context, connection, email, name, secret string) (uuid.UUID, error) {
			created = true
			if _, ok := ctx.Deadline(); !ok || connection != "synthetic-private-connection" || email != "fixture@example.invalid" || name != "Synthetic admin" || secret != "A unique synthetic bootstrap passphrase! 2026" {
				t.Error("incorrect provisioning input")
			}
			return id, nil
		},
	}
	if err := c.run(context.Background(), []string{"user", "create-admin", "--email", "fixture@example.invalid", "--name", "Synthetic admin"}); err != nil {
		t.Fatal(err)
	}
	if !created || !strings.Contains(out.String(), id.String()) || strings.Contains(out.String(), "passphrase") || strings.Contains(out.String(), "synthetic-private") {
		t.Fatal("unsafe CLI output")
	}
	if !bytes.Equal(password, make([]byte, len(password))) || !bytes.Equal(confirmation, make([]byte, len(confirmation))) {
		t.Fatal("secret byte buffers not cleared")
	}
}
func TestCLIErrorsAreRedacted(t *testing.T) {
	for _, cause := range []error{auth.ErrAdminBootstrapped, auth.ErrIdentityExists, auth.ErrPasswordPolicy, errors.New("secret-private-dsn")} {
		var out bytes.Buffer
		c := cli{out: &out, lookup: func(string) string { return "secret-private-dsn" },
			readSecret: func(context.Context, string) ([]byte, error) {
				return []byte("A unique synthetic bootstrap passphrase! 2026"), nil
			},
			create: func(context.Context, string, string, string, string) (uuid.UUID, error) { return uuid.Nil, cause },
		}
		err := c.run(context.Background(), []string{"user", "create-admin", "--email", "fixture@example.invalid", "--name", "Synthetic admin"})
		if err == nil || strings.Contains(err.Error()+out.String(), "secret-private-dsn") {
			t.Fatal("private provisioning error exposed")
		}
	}
}
func TestCLIConfirmationAndReadFailure(t *testing.T) {
	for _, failed := range []bool{false, true} {
		var out bytes.Buffer
		calls := 0
		secret := []byte("first-synthetic-password")
		c := cli{out: &out, lookup: func(string) string { return "synthetic" },
			readSecret: func(context.Context, string) ([]byte, error) {
				calls++
				if failed {
					return secret, errors.New("do-not-echo")
				}
				if calls == 1 {
					return secret, nil
				}
				return []byte("different-synthetic-password"), nil
			},
			create: func(context.Context, string, string, string, string) (uuid.UUID, error) {
				t.Fatal("credential failure created an admin")
				return uuid.Nil, nil
			},
		}
		if err := c.run(context.Background(), []string{"user", "create-admin", "--email", "fixture@example.invalid", "--name", "Fixture"}); err == nil || strings.Contains(err.Error(), "do-not-echo") {
			t.Fatal("unsafe credential failure")
		}
		if !bytes.Equal(secret, make([]byte, len(secret))) {
			t.Fatal("partial secret buffer retained")
		}
	}
}
func TestCLIVersionAndCancellation(t *testing.T) {
	var out bytes.Buffer
	if err := (cli{out: &out}).run(context.Background(), []string{"version"}); err != nil || !strings.Contains(out.String(), version) {
		t.Fatal("version failed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readTerminalSecret(ctx, "not displayed"); !errors.Is(err, context.Canceled) {
		t.Fatal("terminal cancellation ignored")
	}
}
