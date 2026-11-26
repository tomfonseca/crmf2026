package auth

import (
	"bytes"
	"embed"
	"encoding/base64"
	"errors"
	htmltemplate "html/template"
	"log/slog"
	"net/mail"
	"net/url"
	"strings"
	texttemplate "text/template"
	"unicode"
	"unicode/utf8"
)

//go:embed templates/*
var mailTemplates embed.FS

var (
	mailHTML       = htmltemplate.Must(htmltemplate.ParseFS(mailTemplates, "templates/notice.html"))
	mailText       = texttemplate.Must(texttemplate.ParseFS(mailTemplates, "templates/notice.txt"))
	ErrInvalidMail = errors.New("invalid authentication email")
)

type MailKind string

const (
	InviteMail        MailKind = "invite"
	PasswordResetMail MailKind = "password_reset"
)

// MailNotice must never be logged or persisted by callers. Token is a bearer
// secret from a future issuer; passing it here does not make it valid.
type MailNotice struct {
	To    string
	Kind  MailKind
	Realm Realm
	Token string
}

// Prevent accidental ordinary formatting from exposing notice contents.
func (MailNotice) String() string         { return "[redacted authentication email]" }
func (MailNotice) GoString() string       { return "[redacted authentication email]" }
func (n MailNotice) LogValue() slog.Value { return slog.StringValue(n.String()) }
func (MailNotice) MarshalJSON() ([]byte, error) {
	return []byte(`"[redacted authentication email]"`), nil
}

type renderedMail struct{ Subject, Introduction, Action, Lifetime, Link string }

func renderMail(n MailNotice, tenantOrigin, platformOrigin string) (renderedMail, string, string, error) {
	bad := func() (renderedMail, string, string, error) {
		return renderedMail{}, "", "", ErrInvalidMail
	}
	if len(n.To) == 0 || len(n.To) > 254 || !utf8.ValidString(n.To) || strings.ContainsFunc(n.To, unicode.IsControl) {
		return bad()
	}
	address, err := mail.ParseAddress(n.To)
	if err != nil || address.Address != n.To || address.Name != "" {
		return bad()
	}
	if len(n.Token) != 43 {
		return bad()
	}
	token, err := base64.RawURLEncoding.DecodeString(n.Token)
	if err != nil || len(token) != 32 || base64.RawURLEncoding.EncodeToString(token) != n.Token {
		return bad()
	}
	origin, prefix := tenantOrigin, "/login"
	switch n.Realm {
	case Tenant:
	case Platform:
		origin, prefix = platformOrigin, ""
	default:
		return bad()
	}
	var data renderedMail
	var path string
	switch n.Kind {
	case InviteMail:
		data.Subject = "CRMF — Defina sua senha"
		data.Introduction = "Você recebeu um convite para acessar o CRMF."
		data.Action, data.Lifetime, path = "Definir senha", "72 horas", "/convite"
	case PasswordResetMail:
		data.Subject = "CRMF — Redefinição de senha"
		data.Introduction = "Recebemos uma solicitação para redefinir sua senha no CRMF."
		data.Action, data.Lifetime, path = "Redefinir senha", "30 minutos", "/nova-senha"
	default:
		return bad()
	}
	// Configured exact origins only, never an incoming HTTP Host/Origin header.
	u, _ := url.Parse(origin + prefix + path)
	u.Fragment = url.Values{"token": {n.Token}}.Encode()
	data.Link = u.String()
	var text, html bytes.Buffer
	if mailText.Execute(&text, data) != nil || mailHTML.Execute(&html, data) != nil {
		return bad()
	}
	return data, text.String(), html.String(), nil
}
