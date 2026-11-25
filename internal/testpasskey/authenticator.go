// Package testpasskey implements a synthetic P-256 authenticator for protocol
// tests only. Never use these credentials for operator or customer enrollment.
package testpasskey

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

type Authenticator struct {
	key     *ecdsa.PrivateKey
	ID      []byte
	RPID    string
	Handle  string
	Flags   byte
	Counter uint32
}

func New(t testing.TB) *Authenticator {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 32)
	if _, err := rand.Read(id); err != nil {
		t.Fatal(err)
	}
	return &Authenticator{key: key, ID: id, Flags: 5}
}
func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
func marshal(t testing.TB, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func (a *Authenticator) clientData(t testing.TB, kind, challenge, origin string) []byte {
	return marshal(t, map[string]any{"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": false})
}
func (a *Authenticator) Register(t testing.TB, options []byte, origin string) string {
	t.Helper()
	var opts struct {
		Challenge string
		RP        struct{ ID string }
		User      struct{ ID string }
	}
	if err := json.Unmarshal(options, &opts); err != nil {
		t.Fatal(err)
	}
	a.RPID = opts.RP.ID
	a.Handle = opts.User.ID
	rpHash := sha256.Sum256([]byte(a.RPID))
	auth := append(rpHash[:], a.Flags|0x40)
	auth = binary.BigEndian.AppendUint32(auth, 0)
	auth = append(auth, make([]byte, 16)...)
	auth = binary.BigEndian.AppendUint16(auth, uint16(len(a.ID)))
	auth = append(auth, a.ID...)
	cose, err := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: a.key.X.FillBytes(make([]byte, 32)), -3: a.key.Y.FillBytes(make([]byte, 32))})
	if err != nil {
		t.Fatal(err)
	}
	auth = append(auth, cose...)
	attestation, err := cbor.Marshal(map[string]any{"fmt": "none", "authData": auth, "attStmt": map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	return string(marshal(t, map[string]any{"id": b64(a.ID), "rawId": b64(a.ID), "type": "public-key", "authenticatorAttachment": "platform",
		"clientExtensionResults": map[string]any{"credProps": map[string]bool{"rk": true}},
		"response":               map[string]any{"attestationObject": b64(attestation), "clientDataJSON": b64(a.clientData(t, "webauthn.create", opts.Challenge, origin)), "transports": []string{"internal"}}}))
}
func (a *Authenticator) Authenticate(t testing.TB, options []byte, origin string) string {
	t.Helper()
	var opts struct{ Challenge string }
	if err := json.Unmarshal(options, &opts); err != nil {
		t.Fatal(err)
	}
	client := a.clientData(t, "webauthn.get", opts.Challenge, origin)
	rpHash := sha256.Sum256([]byte(a.RPID))
	auth := append(rpHash[:], a.Flags)
	a.Counter++
	auth = binary.BigEndian.AppendUint32(auth, a.Counter)
	clientHash := sha256.Sum256(client)
	signed := append(append([]byte{}, auth...), clientHash[:]...)
	digest := sha256.Sum256(signed)
	signature, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return string(marshal(t, map[string]any{"id": b64(a.ID), "rawId": b64(a.ID), "type": "public-key",
		"clientExtensionResults": map[string]any{}, "authenticatorAttachment": "platform",
		"response": map[string]string{"authenticatorData": b64(auth), "clientDataJSON": b64(client), "signature": b64(signature), "userHandle": a.Handle}}))
}
