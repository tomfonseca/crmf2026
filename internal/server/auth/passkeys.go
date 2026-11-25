package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"time"

	"github.com/crmf/crmf/internal/server/config"
	authdb "github.com/crmf/crmf/internal/server/db/auth"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type passkeyUser struct {
	id          uuid.UUID
	realm       Realm
	credentials []webauthn.Credential
}

func (u passkeyUser) WebAuthnID() []byte {
	s := sha256.Sum256([]byte(string(u.realm) + ":" + u.id.String()))
	return s[:]
}
func (u passkeyUser) WebAuthnName() string                       { return "CRMF " + string(u.realm) + " " + u.id.String() }
func (u passkeyUser) WebAuthnDisplayName() string                { return u.WebAuthnName() }
func (u passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }
func passkeyProviders(tenant, platform string) (map[Realm]*webauthn.WebAuthn, error) {
	if tenant == platform {
		return nil, ErrUnavailable
	}
	out := make(map[Realm]*webauthn.WebAuthn, 2)
	for realm, origin := range map[Realm]string{Tenant: tenant, Platform: platform} {
		if !config.ValidOrigin(origin, true) {
			return nil, ErrUnavailable
		}
		u, _ := url.Parse(origin)
		if net.ParseIP(u.Hostname()) != nil {
			return nil, ErrUnavailable
		}
		provider, err := webauthn.New(&webauthn.Config{RPID: u.Hostname(), RPDisplayName: "CRMF " + string(realm), RPOrigins: []string{origin},
			AttestationPreference:  protocol.PreferNoAttestation,
			AuthenticatorSelection: protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired}})
		if err != nil {
			return nil, ErrUnavailable
		}
		out[realm] = provider
	}
	return out, nil
}
func credentialPurpose(realm Realm, id []byte) string {
	return "passkey-credential:" + string(realm) + ":" + base64.RawURLEncoding.EncodeToString(id)
}
func (e *Engine) loadPasskeys(ctx context.Context, q *authdb.Queries, user pgtype.UUID, realm Realm) ([]webauthn.Credential, error) {
	rows, err := q.PasskeyCredentials(ctx, authdb.PasskeyCredentialsParams{UserID: user, Realm: string(realm)})
	if err != nil {
		return nil, storageError(ctx)
	}
	keys := make([]webauthn.Credential, 0, len(rows))
	for _, row := range rows {
		plain, err := openSecret(e.secrets, uuid.UUID(user.Bytes), credentialPurpose(realm, row.CredentialID), row.CredentialEnc)
		if err != nil {
			return nil, err
		}
		var key webauthn.Credential
		if err := json.Unmarshal([]byte(plain), &key); err != nil {
			return nil, ErrUnavailable
		}
		if base64.RawURLEncoding.EncodeToString(key.ID) != base64.RawURLEncoding.EncodeToString(row.CredentialID) {
			return nil, ErrUnavailable
		}
		keys = append(keys, key)
	}
	return keys, nil
}
func (e *Engine) challenge(ctx context.Context, q *authdb.Queries, user authdb.LockLoginUserRow, realm Realm) (LoginResult, error) {
	keys, err := e.loadPasskeys(ctx, q, user.ID, realm)
	if err != nil {
		return LoginResult{}, err
	}
	owner := passkeyUser{id: uuid.UUID(user.ID.Bytes), realm: realm, credentials: keys}
	kind := "verify"
	var options any
	var session *webauthn.SessionData
	if len(keys) == 0 {
		kind = "enroll"
		creation, state, err := e.passkeys[realm].BeginRegistration(owner, webauthn.WithExtensions(webauthn.WithExtensionCredProps()))
		if err != nil {
			return LoginResult{}, ErrUnavailable
		}
		options = creation.Response
		session = state
	} else {
		assertion, state, err := e.passkeys[realm].BeginLogin(owner)
		if err != nil {
			return LoginResult{}, ErrUnavailable
		}
		options = assertion.Response
		session = state
	}
	now := e.sessions.now().UTC()
	session.Expires = now.Add(5 * time.Minute)
	state, err := json.Marshal(session)
	if err != nil {
		return LoginResult{}, ErrUnavailable
	}
	encrypted, err := sealSecret(e.secrets, owner.id, "passkey-session:"+string(realm)+":"+kind, string(state))
	if err != nil {
		return LoginResult{}, err
	}
	public, err := json.Marshal(options)
	if err != nil {
		return LoginResult{}, ErrUnavailable
	}
	token, hash, err := newToken()
	if err != nil {
		return LoginResult{}, err
	}
	if err := q.ClearPasskeyChallenges(ctx, authdb.ClearPasskeyChallengesParams{UserID: user.ID, Realm: string(realm)}); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if err := q.CreatePasskeyChallenge(ctx, authdb.CreatePasskeyChallengeParams{TokenHash: hash, UserID: user.ID, Realm: string(realm), Kind: kind, SessionEnc: encrypted, CreatedAt: timestamp(now), ExpiresAt: timestamp(now.Add(5 * time.Minute))}); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	if err := auditAuth(ctx, q, pgtype.UUID{}, user.ID, realm, "auth.passkey_challenge", now); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{ChallengeToken: token, PasskeyOptions: public, Enrollment: kind == "enroll"}, nil
}
func (e *Engine) CompletePasskey(ctx context.Context, challenge, response string, realm Realm, ip netip.Addr) (LoginResult, error) {
	if err := e.reserveAttempt(ctx, ip); err != nil {
		return LoginResult{}, err
	}
	hash, err := tokenHash(challenge)
	if err != nil || (realm != Tenant && realm != Platform) || len(response) > 8192 {
		return LoginResult{}, ErrUnauthenticated
	}
	tx, err := e.sessions.pool.Begin(ctx)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := authdb.New(tx)
	id, err := q.PasskeyChallengeOwner(ctx, authdb.PasskeyChallengeOwnerParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return e.reject(ctx, tx, q, nil, realm, "auth.passkey_failed")
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	user, err := q.LockLoginUser(ctx, id)
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	pending, err := q.LockPasskeyChallenge(ctx, authdb.LockPasskeyChallengeParams{TokenHash: hash, Realm: string(realm)})
	if errors.Is(err, pgx.ErrNoRows) {
		return e.reject(ctx, tx, q, nil, realm, "auth.passkey_failed")
	}
	if err != nil {
		return LoginResult{}, storageError(ctx)
	}
	now := e.sessions.now().UTC()
	if pending.UsedAt.Valid || pending.Attempts >= 5 || !now.Before(pending.ExpiresAt.Time) || user.Status != "active" || (user.LockedUntil.Valid && now.Before(user.LockedUntil.Time)) {
		return e.reject(ctx, tx, q, nil, realm, "auth.passkey_failed")
	}
	if _, err := readScope(ctx, q, id, realm, true, true); err != nil {
		if errors.Is(err, ErrUnavailable) {
			return LoginResult{}, err
		}
		return e.reject(ctx, tx, q, nil, realm, "auth.passkey_failed")
	}
	plain, err := openSecret(e.secrets, uuid.UUID(id.Bytes), "passkey-session:"+string(realm)+":"+pending.Kind, pending.SessionEnc)
	if err != nil {
		return LoginResult{}, err
	}
	var session webauthn.SessionData
	if err := json.Unmarshal([]byte(plain), &session); err != nil {
		return LoginResult{}, ErrUnavailable
	}
	keys, err := e.loadPasskeys(ctx, q, id, realm)
	if err != nil {
		return LoginResult{}, err
	}
	owner := passkeyUser{id: uuid.UUID(id.Bytes), realm: realm, credentials: keys}
	var credential *webauthn.Credential
	valid := false
	// Recovery is an explicit single-use break-glass code plus the password proof,
	// never a six-digit OTP and never permitted to bypass initial key enrollment.
	if pending.Kind == "verify" && len(keys) > 0 && len(response) == 32 {
		_, err = q.UseRecoveryCode(ctx, authdb.UseRecoveryCodeParams{UserID: id, CodeHash: recoveryHash(response), UsedAt: timestamp(now)})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return LoginResult{}, storageError(ctx)
		}
		valid = err == nil
	} else if pending.Kind == "enroll" && len(keys) == 0 {
		parsed, parseErr := protocol.ParseCredentialCreationResponseBytes([]byte(response))
		if parseErr == nil {
			credential, err = e.passkeys[realm].CreateCredential(owner, session, parsed)
			valid = err == nil && credential != nil
		}
	} else if pending.Kind == "verify" && len(keys) > 0 {
		parsed, parseErr := protocol.ParseCredentialRequestResponseBytes([]byte(response))
		if parseErr == nil {
			credential, err = e.passkeys[realm].ValidateLogin(owner, session, parsed)
			valid = err == nil && credential != nil && !credential.Authenticator.CloneWarning
		}
	}
	if !valid {
		if err := q.FailPasskeyChallenge(ctx, hash); err != nil {
			return LoginResult{}, storageError(ctx)
		}
		return e.reject(ctx, tx, q, &user, realm, "auth.passkey_failed")
	}
	if err := q.ConsumePasskeyChallenge(ctx, authdb.ConsumePasskeyChallengeParams{TokenHash: hash, UsedAt: timestamp(now)}); err != nil {
		return LoginResult{}, storageError(ctx)
	}
	var codes []string
	if credential != nil {
		value, err := json.Marshal(credential)
		if err != nil {
			return LoginResult{}, ErrUnavailable
		}
		encrypted, err := sealSecret(e.secrets, owner.id, credentialPurpose(realm, credential.ID), string(value))
		if err != nil {
			return LoginResult{}, err
		}
		if pending.Kind == "enroll" {
			if err := q.AddPasskeyCredential(ctx, authdb.AddPasskeyCredentialParams{CredentialID: credential.ID, UserID: id, Realm: string(realm), CredentialEnc: encrypted, CreatedAt: timestamp(now)}); err != nil {
				return LoginResult{}, storageError(ctx)
			}
			if err := q.ClearRecoveryCodes(ctx, id); err != nil {
				return LoginResult{}, storageError(ctx)
			}
			for range 10 {
				code, digest, err := recoveryCode()
				if err != nil {
					return LoginResult{}, err
				}
				if err := q.AddRecoveryCode(ctx, authdb.AddRecoveryCodeParams{UserID: id, CodeHash: digest}); err != nil {
					return LoginResult{}, storageError(ctx)
				}
				codes = append(codes, code)
			}
			if err := auditAuth(ctx, q, id, id, realm, "auth.passkey_enrolled", now); err != nil {
				return LoginResult{}, err
			}
		} else {
			if err := q.UpdatePasskeyCredential(ctx, authdb.UpdatePasskeyCredentialParams{CredentialID: credential.ID, UserID: id, Realm: string(realm), CredentialEnc: encrypted, UpdatedAt: timestamp(now)}); err != nil {
				return LoginResult{}, storageError(ctx)
			}
		}
	}
	if pending.Kind == "verify" {
		action := "auth.passkey_verified"
		if credential == nil {
			action = "auth.recovery_used"
		}
		if err := auditAuth(ctx, q, id, id, realm, action, now); err != nil {
			return LoginResult{}, err
		}
	}
	return e.finish(ctx, tx, q, user, realm, ip, true, codes)
}
