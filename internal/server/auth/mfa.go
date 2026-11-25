package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/google/uuid"
)

func newSecretCipher(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("authentication state requires an externally supplied 32-byte key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrUnavailable
	}
	return cipher.NewGCM(block)
}
func sealSecret(aead cipher.AEAD, id uuid.UUID, purpose, secret string) ([]byte, error) {
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, ErrUnavailable
	}
	envelope := append([]byte{1}, nonce...)
	return aead.Seal(envelope, nonce, []byte(secret), []byte(purpose+":"+id.String())), nil
}
func openSecret(aead cipher.AEAD, id uuid.UUID, purpose string, envelope []byte) (string, error) {
	n := aead.NonceSize()
	if len(envelope) < 1+n+aead.Overhead() || envelope[0] != 1 {
		return "", ErrUnavailable
	}
	plain, err := aead.Open(nil, envelope[1:1+n], envelope[1+n:], []byte(purpose+":"+id.String()))
	if err != nil {
		return "", ErrUnavailable
	}
	return string(plain), nil
}
func recoveryCode() (string, string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", "", ErrUnavailable
	}
	code := hex.EncodeToString(raw)
	return code, recoveryHash(code), nil
}
func recoveryHash(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
