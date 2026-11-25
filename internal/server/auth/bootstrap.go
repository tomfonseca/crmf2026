package auth

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"unicode"
	"unicode/utf8"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidIdentity   = errors.New("invalid user identity")
	ErrAdminBootstrapped = errors.New("platform administrator already bootstrapped")
	ErrIdentityExists    = errors.New("identity already exists")
)

func ValidateUserIdentity(email, name string) error {
	email = strings.TrimSpace(email)
	name = strings.TrimSpace(name)
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 254 || !utf8.ValidString(email) || name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 160 {
		return ErrInvalidIdentity
	}
	for _, value := range []string{email, name} {
		for _, r := range value {
			if unicode.IsControl(r) {
				return ErrInvalidIdentity
			}
		}
	}
	return nil
}

// BootstrapFirstAdmin is an operator capability for crmfctl, not an HTTP
// operation. It never promotes/replaces an existing identity or issues tokens.
// A durable marker keeps bootstrap closed after admin deactivation/deletion.
func (s *Service) BootstrapFirstAdmin(ctx context.Context, email, name, password string) (uuid.UUID, error) {
	if err := ValidateUserIdentity(email, name); err != nil {
		return uuid.Nil, err
	}
	email = strings.TrimSpace(email)
	name = strings.TrimSpace(name)
	passwords, err := NewPasswords()
	if err != nil {
		return uuid.Nil, ErrUnavailable
	}
	if err := passwords.Validate(password); err != nil {
		return uuid.Nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	if err := q.LockPlatformBootstrap(ctx); err != nil {
		return uuid.Nil, storageError(ctx)
	}
	initialized, err := q.PlatformBootstrapped(ctx)
	if err != nil {
		return uuid.Nil, storageError(ctx)
	}
	if initialized {
		return uuid.Nil, ErrAdminBootstrapped
	}
	_, err = q.LoginOwner(ctx, email)
	if err == nil {
		return uuid.Nil, ErrIdentityExists
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, storageError(ctx)
	}
	encoded, err := passwords.Hash(ctx, password)
	if err != nil {
		return uuid.Nil, err
	}
	user, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, ErrUnavailable
	}
	grant, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, ErrUnavailable
	}
	id := pgtype.UUID{Bytes: user, Valid: true}
	now := s.now().UTC()
	if err := q.CreateBootstrapUser(ctx, authdb.CreateBootstrapUserParams{ID: id, Email: email, Name: name, PasswordHash: encoded, At: timestamp(now)}); err != nil {
		return uuid.Nil, storageError(ctx)
	}
	if err := q.CreateBootstrapGrant(ctx, authdb.CreateBootstrapGrantParams{ID: pgtype.UUID{Bytes: grant, Valid: true}, UserID: id, CreatedAt: timestamp(now)}); err != nil {
		return uuid.Nil, storageError(ctx)
	}
	if err := q.MarkPlatformBootstrapped(ctx, authdb.MarkPlatformBootstrappedParams{AdminUserID: id, CreatedAt: timestamp(now)}); err != nil {
		return uuid.Nil, storageError(ctx)
	}
	if err := auditAuth(ctx, q, pgtype.UUID{}, id, Platform, "auth.admin_bootstrapped", now); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, storageError(ctx)
	}
	return user, nil
}
