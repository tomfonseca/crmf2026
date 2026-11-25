package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

var ErrUnauthenticated = errors.New("authentication required")

func newToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, errors.New("generate opaque token")
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256(raw)
	return token, hash[:], nil
}

func tokenHash(token string) ([]byte, error) {
	if len(token) != 43 {
		return nil, ErrUnauthenticated
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(raw) != 32 {
		return nil, ErrUnauthenticated
	}
	hash := sha256.Sum256(raw)
	return hash[:], nil
}
