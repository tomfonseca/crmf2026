// Package tenancy owns privileged provisioning and context-bound runtime pools.
// Provisioning is operator-only; API/worker never receive migration credentials.
package tenancy

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/google/uuid"
)

var (
	ErrUnavailable       = errors.New("tenant operation unavailable")
	ErrInvalid           = errors.New("invalid tenant identity")
	ErrConflict          = errors.New("tenant identity or resources conflict")
	ErrBusy              = errors.New("tenant provisioning already running")
	ErrCredentialMissing = errors.New("recover original tenant credential; do not regenerate")
)
var slugPattern = regexp.MustCompile(`^[a-z0-9_]{3,40}$`)
var passwordPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var versionPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`)

// Credential is never serialized or formatted with its secret value.
type Credential struct {
	TenantID uuid.UUID `json:"tenant_id"`
	Version  string    `json:"version"`
	Password string    `json:"-"`
}

func (Credential) Format(s fmt.State, _ rune) {
	_, _ = io.WriteString(s, "[REDACTED tenant credential]")
}

// Credentials adapters must bind secrets to tenant identity, never overwrite a
// known version, and distinguish absence from transport/permission failures.
type Credentials interface {
	Get(context.Context, uuid.UUID, string, string) (Credential, error)
	Create(context.Context, uuid.UUID, string) (Credential, error)
}

func secretName(slug string) string { return "pg-tenant-" + strings.ReplaceAll(slug, "_", "-") }
func validCredential(c Credential, id uuid.UUID) bool {
	return id != uuid.Nil && c.TenantID == id && versionPattern.MatchString(c.Version) && passwordPattern.MatchString(c.Password)
}
func newCredential(id uuid.UUID) (Credential, error) {
	if id == uuid.Nil {
		return Credential{}, ErrInvalid
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Credential{}, ErrUnavailable
	}
	defer clear(raw)
	return Credential{TenantID: id, Version: uuid.NewString(), Password: base64.RawURLEncoding.EncodeToString(raw)}, nil
}

// DevelopmentFiles is explicit local-only custody. Never use it in Azure.
// The directory must be private and outside the build context; Windows also
// requires workstation ACLs. Existing files are never replaced or regenerated.
type DevelopmentFiles struct{ directory string }

func NewDevelopmentFiles(directory string, development bool) (*DevelopmentFiles, error) {
	if !development || directory == "" {
		return nil, ErrInvalid
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, ErrUnavailable
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return nil, ErrUnavailable
	}
	return &DevelopmentFiles{directory: directory}, nil
}
func (s *DevelopmentFiles) path(slug string) (string, error) {
	if !slugPattern.MatchString(slug) {
		return "", ErrInvalid
	}
	return filepath.Join(s.directory, secretName(slug)+".json"), nil
}

type fileCredential struct {
	TenantID          uuid.UUID
	Version, Password string
}

func (s *DevelopmentFiles) Get(ctx context.Context, id uuid.UUID, slug, version string) (Credential, error) {
	if ctx.Err() != nil {
		return Credential{}, ctx.Err()
	}
	path, err := s.path(slug)
	if err != nil {
		return Credential{}, err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Credential{}, ErrCredentialMissing
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > 2048 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return Credential{}, ErrUnavailable
	}
	f, err := os.Open(path)
	if err != nil {
		return Credential{}, ErrUnavailable
	}
	defer func() { _ = f.Close() }()
	var value fileCredential
	decoder := json.NewDecoder(io.LimitReader(f, 2049))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil {
		return Credential{}, ErrUnavailable
	}
	var extra any
	if !errors.Is(decoder.Decode(&extra), io.EOF) {
		return Credential{}, ErrUnavailable
	}
	result := Credential(value)
	if !validCredential(result, id) || (version != "" && version != result.Version) {
		return Credential{}, ErrCredentialMissing
	}
	return result, nil
}
func (s *DevelopmentFiles) Create(ctx context.Context, id uuid.UUID, slug string) (Credential, error) {
	if ctx.Err() != nil {
		return Credential{}, ctx.Err()
	}
	path, err := s.path(slug)
	if err != nil {
		return Credential{}, err
	}
	value, err := newCredential(id)
	if err != nil {
		return Credential{}, err
	}
	// Write a complete private temporary file, then publish using a no-replace
	// hard link. A crash cannot expose a partially written credential as valid.
	f, err := os.CreateTemp(s.directory, ".tenant-pending-*")
	if err != nil {
		return Credential{}, ErrUnavailable
	}
	temporary := f.Name()
	defer func() { _ = os.Remove(temporary) }()
	data, err := json.Marshal(fileCredential(value))
	if err != nil {
		_ = f.Close()
		return Credential{}, ErrUnavailable
	}
	defer clear(data)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return Credential{}, ErrUnavailable
	}
	if err = os.Link(temporary, path); err != nil {
		return Credential{}, ErrConflict
	}
	return value, nil
}
