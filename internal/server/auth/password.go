// Package auth owns identity, password and session verification.
package auth

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

//go:embed passwords/common.txt
var commonPasswords []byte

var (
	ErrPasswordPolicy = errors.New("password does not meet policy")
	ErrInvalidHash    = errors.New("invalid password hash")
)

// Passwords limits concurrent Argon2 allocations. Reuse one instance per process.
type Passwords struct {
	common map[[32]byte]struct{}
	slots  chan struct{}
}

func NewPasswords() (*Passwords, error) {
	p := &Passwords{common: make(map[[32]byte]struct{}, 100000), slots: make(chan struct{}, 2)}
	scan := bufio.NewScanner(bytes.NewReader(commonPasswords))
	count := 0
	for scan.Scan() {
		value := scan.Text()
		if value == "" {
			return nil, errors.New("invalid password denylist")
		}
		p.common[sha256.Sum256([]byte(strings.ToLower(value)))] = struct{}{}
		count++
	}
	if scan.Err() != nil || count != 100000 {
		return nil, errors.New("invalid password denylist")
	}
	return p, nil
}

func (p *Passwords) Validate(password string) error {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 12 || len(password) > 1024 {
		return ErrPasswordPolicy
	}
	if _, exists := p.common[sha256.Sum256([]byte(strings.ToLower(password)))]; exists {
		return ErrPasswordPolicy
	}
	return nil
}

func (p *Passwords) Hash(ctx context.Context, password string) (string, error) {
	if err := p.Validate(password); err != nil {
		return "", err
	}
	if err := p.acquire(ctx); err != nil {
		return "", err
	}
	defer func() { <-p.slots }()
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", errors.New("generate password salt")
	}
	key := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

type PasswordMatch struct{ Valid, NeedsRehash bool }

func (p *Passwords) Verify(ctx context.Context, password, encoded string) (PasswordMatch, error) {
	if len(password) == 0 || len(password) > 1024 || !utf8.ValidString(password) {
		return PasswordMatch{}, nil
	}
	memory, iterations, parallelism, salt, expected, err := parseHash(encoded)
	if err != nil {
		return PasswordMatch{}, err
	}
	if err := p.acquire(ctx); err != nil {
		return PasswordMatch{}, err
	}
	defer func() { <-p.slots }()
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expected)))
	valid := subtle.ConstantTimeCompare(actual, expected) == 1
	return PasswordMatch{Valid: valid, NeedsRehash: valid && (memory != 65536 || iterations != 3 || parallelism != 2 || len(salt) != 16 || len(expected) != 32)}, nil
}

func (p *Passwords) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case p.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Bound all stored parameters before allocating memory, including legacy hashes.
func parseHash(encoded string) (uint32, uint32, uint8, []byte, []byte, error) {
	bad := func() (uint32, uint32, uint8, []byte, []byte, error) { return 0, 0, 0, nil, nil, ErrInvalidHash }
	if len(encoded) > 512 {
		return bad()
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" {
		return bad()
	}
	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		return bad()
	}
	values := make([]uint64, 3)
	for i, prefix := range []string{"m=", "t=", "p="} {
		if !strings.HasPrefix(params[i], prefix) {
			return bad()
		}
		value, err := strconv.ParseUint(strings.TrimPrefix(params[i], prefix), 10, 32)
		if err != nil {
			return bad()
		}
		values[i] = value
	}
	m, t, p := values[0], values[1], values[2]
	if p < 1 || p > 2 || m < 8*p || m > 65536 || t < 1 || t > 3 {
		return bad()
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return bad()
	}
	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(key) < 32 || len(key) > 64 {
		return bad()
	}
	return uint32(m), uint32(t), uint8(p), salt, key, nil
}
