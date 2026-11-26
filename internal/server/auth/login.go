package auth

import (
	"context"
	"crypto/cipher"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"time"

	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var ErrRateLimited = errors.New("too many authentication attempts")

// Engine owns credential proof and session issuance. The key protects durable
// ceremony/credential state; authenticator private keys never reach the server.
type Engine struct {
	sessions    *Service
	passwords   *Passwords
	secrets     cipher.AEAD
	dummyHash   string
	recoveryKey [32]byte
	passkeys    map[Realm]*webauthn.WebAuthn
}

func (*Engine) String() string   { return "[redacted authentication engine]" }
func (*Engine) GoString() string { return "[redacted authentication engine]" }

type LoginResult struct {
	SessionToken   string          `json:"-"`
	ChallengeToken string          `json:"-"`
	PasskeyOptions json.RawMessage `json:"-"`
	Enrollment     bool            `json:"-"`
	RecoveryCodes  []string        `json:"-"`
}

func (LoginResult) String() string   { return "[redacted authentication result]" }
func (LoginResult) GoString() string { return "[redacted authentication result]" }

func NewEngine(ctx context.Context, sessions *Service, key []byte, tenantOrigin, platformOrigin string) (*Engine, error) {
	if sessions == nil {
		return nil, ErrUnavailable
	}
	aead, err := newSecretCipher(key)
	if err != nil {
		return nil, err
	}
	providers, err := passkeyProviders(tenantOrigin, platformOrigin)
	if err != nil {
		return nil, err
	}
	passwords, err := NewPasswords()
	if err != nil {
		return nil, err
	}
	dummy, _, err := newToken()
	if err != nil {
		return nil, err
	}
	hash, err := passwords.Hash(ctx, dummy)
	if err != nil {
		return nil, err
	}
	return &Engine{sessions: sessions, passwords: passwords, secrets: aead, dummyHash: hash, passkeys: providers, recoveryKey: recoveryMAC(key, "recovery-index-v1", "")}, nil
}
func (e *Engine) Login(ctx context.Context, email, password string, realm Realm, ip netip.Addr) (LoginResult, error) {
	if err := e.reserveAttempt(ctx, ip); err != nil {
		return LoginResult{}, err
	}
	if realm != Tenant && realm != Platform {
		return LoginResult{}, ErrUnauthenticated
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	id, err := q.LoginOwner(ctx, strings.TrimSpace(email))
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := e.passwords.Verify(ctx, password, e.dummyHash); err != nil {
			return LoginResult{}, storageError(ctx)
		}
		return e.reject(ctx, tx, q, nil, realm, "auth.login_failed")
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	user, err := q.LockLoginUser(ctx, id)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	now := e.sessions.now().UTC()
	blocked := user.Status != "active" || (user.LockedUntil.Valid && now.Before(user.LockedUntil.Time))
	hash := user.PasswordHash.String
	usable := user.PasswordHash.Valid && !blocked
	if !usable {
		hash = e.dummyHash
	}
	match, err := e.passwords.Verify(ctx, password, hash)
	if errors.Is(err, ErrInvalidHash) {
		usable = false
		match, err = e.passwords.Verify(ctx, password, e.dummyHash)
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if !usable || !match.Valid {
		if blocked {
			return e.reject(ctx, tx, q, nil, realm, "auth.login_failed")
		}
		return e.reject(ctx, tx, q, &user, realm, "auth.login_failed")
	}
	scope, err := readScope(ctx, q, id, realm, true, true)
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			return LoginResult{}, err
		}
		return e.reject(ctx, tx, q, &user, realm, "auth.login_failed")
	}
	if match.NeedsRehash {
		encoded, err := e.passwords.Hash(ctx, password)
		if err != nil {
			return LoginResult{}, storageError(ctx)
		}
		if err := q.RehashPassword(ctx, authdb.RehashPasswordParams{ID: id, PasswordHash: pgtype.Text{String: encoded, Valid: true}, UpdatedAt: timestamp(now)}); err != nil {
			return LoginResult{}, storageError(ctx)
		}
	}
	keys, err := e.loadPasskeys(ctx, q, id, realm)
	if err != nil {
		return LoginResult{}, err
	}
	required := realm == Platform || len(keys) > 0 || user.MfaEnabledAt.Valid
	for _, g := range scope.grants {
		required = required || g.RequireMFA
	}
	if required {
		result, err := e.challenge(ctx, q, user, realm)
		if err != nil {
			return LoginResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return LoginResult{}, storageError(ctx)
		}
		return result, nil
	}
	return e.finish(ctx, tx, q, user, realm, ip, false, nil)
}
func (e *Engine) finish(ctx context.Context, tx pgx.Tx, q *authdb.Queries, user authdb.LockLoginUserRow, realm Realm, ip netip.Addr, mfa bool, codes []string) (LoginResult, error) {
	now := e.sessions.now().UTC()
	token, hash, err := newToken()
	if err != nil {
		return LoginResult{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return LoginResult{}, ErrUnavailable
	}
	idle, absolute := 12*time.Hour, 7*24*time.Hour
	if realm == Platform {
		idle, absolute = 30*time.Minute, 12*time.Hour
	}
	err = q.CreateSession(ctx, authdb.CreateSessionParams{ID: pgtype.UUID{Bytes: id, Valid: true}, UserID: user.ID, TokenHash: hash, Realm: string(realm), MfaVerified: mfa, Ip: &ip, LastSeenAt: timestamp(now), IdleExpiresAt: timestamp(now.Add(idle)), ExpiresAt: timestamp(now.Add(absolute))})
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if err := q.LoginSuccess(ctx, authdb.LoginSuccessParams{ID: user.ID, LastLoginAt: timestamp(now)}); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if err := auditAuth(ctx, q, user.ID, user.ID, realm, "auth.login", now); err != nil {
		return LoginResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	return LoginResult{SessionToken: token, RecoveryCodes: codes}, nil
}
func (e *Engine) reject(ctx context.Context, tx pgx.Tx, q *authdb.Queries, user *authdb.LockLoginUserRow, realm Realm, action string) (LoginResult, error) {
	now := e.sessions.now().UTC()
	var target pgtype.UUID
	if user != nil {
		target = user.ID
		failed := min(user.FailedLogins, 999999) + 1
		var until pgtype.Timestamptz
		if failed%5 == 0 {
			minutes := []time.Duration{1, 5, 15, 60}
			index := min(int(failed/5)-1, 3)
			until = timestamp(now.Add(minutes[index] * time.Minute))
			if err := auditAuth(ctx, q, pgtype.UUID{}, target, realm, "auth.account_locked", now); err != nil {
				return LoginResult{}, err
			}
		}
		if err := q.RecordFailure(ctx, authdb.RecordFailureParams{ID: user.ID, FailedLogins: failed, LockedUntil: until, UpdatedAt: timestamp(now)}); err != nil {
			return LoginResult{}, storageError(ctx)
		}
	}
	if err := auditAuth(ctx, q, pgtype.UUID{}, target, realm, action, now); err != nil {
		return LoginResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	return LoginResult{}, ErrUnauthenticated
}
func auditAuth(ctx context.Context, q *authdb.Queries, actor, target pgtype.UUID, realm Realm, action string, now time.Time) error {
	name := "auth"
	if target.Valid {
		name = uuid.UUID(target.Bytes).String()
	}
	if err := q.AuditAuth(ctx, authdb.AuditAuthParams{Actor: actor, Action: action, Target: name, Realm: string(realm), At: timestamp(now)}); err != nil {
		return storageError(ctx)
	}
	return nil
}
