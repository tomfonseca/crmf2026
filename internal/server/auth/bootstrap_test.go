package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestBootstrapIdentityValidation(t *testing.T) {
	for _, tc := range [][2]string{
		{"invalid", "Synthetic admin"},
		{"Name <fixture@example.invalid>", "Synthetic admin"},
		{"fixture@example.invalid", ""},
		{"fixture@example.invalid", strings.Repeat("x", 161)},
		{"fixture@example.invalid", "Synthetic\nadmin"},
		{"fixture@example.invalid", string([]byte{0xff})},
	} {
		if !errors.Is(ValidateUserIdentity(tc[0], tc[1]), ErrInvalidIdentity) {
			t.Fatal("invalid identity accepted")
		}
	}
	if err := ValidateUserIdentity(" fixture@example.invalid ", " Administrador Sintético "); err != nil {
		t.Fatal(err)
	}
}
