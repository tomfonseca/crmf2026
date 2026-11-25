package tenancy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDevelopmentCredentialCustody(t *testing.T) {
	ctx := context.Background()
	directory := filepath.Join(t.TempDir(), "private-credentials")
	store, err := NewDevelopmentFiles(directory, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewDevelopmentFiles(directory, false); err == nil {
		t.Fatal("production file fallback")
	}
	id := uuid.New()
	slug := "synthetic_tenant"
	if _, err := store.Get(ctx, id, slug, ""); !errors.Is(err, ErrCredentialMissing) {
		t.Fatal(err)
	}
	credential, err := store.Create(ctx, id, slug)
	if err != nil {
		t.Fatal(err)
	}
	if !validCredential(credential, id) {
		t.Fatal("invalid generated credential")
	}
	for _, format := range []string{"%v", "%+v", "%#v", "%s", "%q"} {
		if strings.Contains(fmt.Sprintf(format, credential), credential.Password) {
			t.Fatal("formatter leaked password")
		}
	}
	raw, err := json.Marshal(credential)
	if err != nil || strings.Contains(string(raw), credential.Password) {
		t.Fatal("JSON leaked password")
	}
	repeated, err := store.Get(ctx, id, slug, credential.Version)
	if err != nil || repeated.Password != credential.Password {
		t.Fatal("not durable")
	}
	if _, err := store.Create(ctx, id, slug); !errors.Is(err, ErrConflict) {
		t.Fatal("overwrote existing credential")
	}
	for _, pair := range []struct {
		id      uuid.UUID
		version string
	}{{uuid.New(), credential.Version}, {id, "wrong-version"}} {
		if _, err := store.Get(ctx, pair.id, slug, pair.version); err == nil {
			t.Fatal("identity/version mismatch accepted")
		}
	}
	for _, unsafe := range []string{"../escape", "a-b", "UPPER", "aa", "a/b", strings.Repeat("a", 41)} {
		if _, err := store.Create(ctx, id, unsafe); !errors.Is(err, ErrInvalid) {
			t.Fatal("unsafe name accepted")
		}
	}
	path, _ := store.path(slug)
	if err := os.WriteFile(path, []byte("{partial"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, id, slug, ""); !errors.Is(err, ErrUnavailable) {
		t.Fatal("malformed file became missing")
	}
	// A damaged credential is not replaced even if a caller tries Create.
	if _, err := store.Create(ctx, id, slug); !errors.Is(err, ErrConflict) {
		t.Fatal("damaged file overwritten")
	}
	matches, _ := filepath.Glob(filepath.Join(directory, ".tenant-pending-*"))
	if len(matches) != 0 {
		t.Fatal("temporary credential left behind")
	}
	canceled, stop := context.WithCancel(ctx)
	stop()
	if _, err := store.Get(canceled, id, slug, ""); !errors.Is(err, context.Canceled) {
		t.Fatal("ignored cancellation")
	}
}
func TestDevelopmentFilesRejectBroadPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows custody relies on workstation ACLs, not POSIX mode bits")
	}
	directory := filepath.Join(t.TempDir(), "unsafe")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := NewDevelopmentFiles(directory, true); !errors.Is(err, ErrUnavailable) {
		t.Fatal("broad directory permissions accepted")
	}
}
func TestProvisionInputAndSecretNames(t *testing.T) {
	valid := ProvisionInput{Slug: "synthetic_123", LegalName: "Synthetic tenant", CNPJ: "ABCDEF12345600", PlanID: uuid.New()}
	if !validProvisionInput(valid) {
		t.Fatal("valid input rejected")
	}
	for _, change := range []func(*ProvisionInput){
		func(i *ProvisionInput) { i.Slug = "x;drop" }, func(i *ProvisionInput) { i.CNPJ = "123" },
		func(i *ProvisionInput) { i.LegalName = " bad " }, func(i *ProvisionInput) { i.LegalName = "bad\nname" },
		func(i *ProvisionInput) { i.PlanID = uuid.Nil },
	} {
		copy := valid
		change(&copy)
		if validProvisionInput(copy) {
			t.Fatal("invalid identity accepted")
		}
	}
	if secretName("a_b") != "pg-tenant-a-b" {
		t.Fatal("Azure name incompatible")
	}
	if secretName("a_b") == secretName("a__b") {
		t.Fatal("secret name collision")
	}
	for _, bad := range []string{"http://x.vault.azure.net", "https://evil.invalid", "https://x.vault.azure.net/path", "https://user:secret@x.vault.azure.net", "https://x.vault.azure.net?token=secret"} {
		if _, err := NewVault(bad, ""); err == nil {
			t.Fatal("unsafe vault endpoint accepted")
		}
	}
}
func TestManagerRequiresPrincipalBeforeDependencies(t *testing.T) {
	var manager *Manager
	if _, err := manager.Pool(context.Background()); !errors.Is(err, auth.ErrForbidden) {
		t.Fatal("anonymous accepted")
	}
	if _, err := NewManager(context.Background(), nil, "", nil); err == nil {
		t.Fatal("missing dependencies accepted")
	}
	// A closed/pruned cache never starts a timer in this unit fixture.
	m := &Manager{entries: map[uuid.UUID]*poolEntry{}}
	m.prune(time.Now().Add(time.Hour))
}
func TestIdlePoolObjectsAreEvicted(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://unused:unused@localhost:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ready := make(chan struct{})
	close(ready)
	id := uuid.New()
	pending := uuid.New()
	m := &Manager{entries: map[uuid.UUID]*poolEntry{
		id:      {ready: ready, pool: pool, lastUsed: time.Now().Add(-11 * time.Minute)},
		pending: {ready: make(chan struct{}), lastUsed: time.Now().Add(-11 * time.Minute)},
	}}
	m.prune(time.Now())
	if _, exists := m.entries[id]; exists {
		t.Fatal("idle pool retained")
	}
	if _, exists := m.entries[pending]; !exists {
		t.Fatal("in-flight pool evicted")
	}
	ctx, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	if _, err := pool.Acquire(ctx); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatal("idle pool was not closed")
	}
}
