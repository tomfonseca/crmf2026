package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/google/uuid"
)

var version = "dev"

type cli struct {
	lookup     func(string) string
	out        io.Writer
	readSecret func(context.Context, string) ([]byte, error)
	create     func(context.Context, string, string, string, string) (uuid.UUID, error)
}

const usage = "usage: crmfctl version | user create-admin --email <email> --name <name>"

func main() {
	os.Exit(execute())
}
func execute() int {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	c := cli{lookup: os.Getenv, out: os.Stdout, readSecret: readTerminalSecret, create: createAdmin}
	if err := c.run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}
func (c cli) run(ctx context.Context, args []string) error {
	if len(args) == 1 && args[0] == "version" {
		_, err := fmt.Fprintln(c.out, version)
		return err
	}
	if len(args) == 1 && (args[0] == "help" || args[0] == "--help") {
		_, err := fmt.Fprintln(c.out, usage)
		return err
	}
	if len(args) < 2 || args[0] != "user" || args[1] != "create-admin" {
		return errors.New(usage)
	}
	flags := flag.NewFlagSet("create-admin", flag.ContinueOnError)
	// Flag errors can contain submitted values; never forward them to output.
	flags.SetOutput(io.Discard)
	email := flags.String("email", "", "administrator email")
	name := flags.String("name", "", "administrator name")
	if err := flags.Parse(args[2:]); errors.Is(err, flag.ErrHelp) {
		_, outputErr := fmt.Fprintln(c.out, usage)
		return outputErr
	} else if err != nil || flags.NArg() != 0 {
		return errors.New(usage)
	}
	if err := auth.ValidateUserIdentity(*email, *name); err != nil {
		return errors.New("informe e-mail simples válido e nome de até 160 caracteres")
	}
	connection := c.lookup("AUTH_DATABASE_URL")
	if connection == "" {
		return errors.New("AUTH_DATABASE_URL deve usar o role isolado crmf_auth")
	}
	password, err := c.readSecret(ctx, "Senha (mínimo 12 caracteres; sem eco): ")
	defer clear(password)
	if err != nil {
		return errors.New("não foi possível ler a senha no terminal")
	}
	confirmation, err := c.readSecret(ctx, "Confirme a senha: ")
	defer clear(confirmation)
	if err != nil {
		return errors.New("não foi possível confirmar a senha no terminal")
	}
	if subtle.ConstantTimeCompare(password, confirmation) != 1 {
		return errors.New("as senhas não coincidem")
	}
	operation, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	id, err := c.create(operation, connection, strings.TrimSpace(*email), strings.TrimSpace(*name), string(password))
	switch {
	case errors.Is(err, auth.ErrAdminBootstrapped):
		return errors.New("bootstrap encerrado: o administrador inicial já foi provisionado; use gestão autenticada")
	case errors.Is(err, auth.ErrIdentityExists):
		return errors.New("o e-mail já está cadastrado; nenhuma identidade foi alterada")
	case errors.Is(err, auth.ErrPasswordPolicy):
		return errors.New("senha recusada: use ao menos 12 caracteres, até 1024 bytes e fora da lista de senhas comuns")
	case err != nil:
		return errors.New("não foi possível criar o administrador; verifique a configuração e as migrações")
	}
	_, err = fmt.Fprintf(c.out, "Administrador inicial criado: %s. MFA obrigatório no primeiro login do QG. Nenhuma sessão foi emitida.\n", id)
	return err
}
func createAdmin(ctx context.Context, connection, email, name, password string) (uuid.UUID, error) {
	sessions, err := auth.Open(ctx, connection)
	if err != nil {
		return uuid.Nil, auth.ErrUnavailable
	}
	defer sessions.Close()
	return sessions.BootstrapFirstAdmin(ctx, email, name, password)
}
