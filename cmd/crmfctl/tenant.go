package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/google/uuid"
)

func (c cli) provisionTenant(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("tenant provision", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	slug := flags.String("slug", "", "immutable tenant slug")
	name := flags.String("legal-name", "", "legal name")
	cnpj := flags.String("cnpj", "", "canonical CNPJ")
	plan := flags.String("plan-id", "", "existing active plan UUID")
	if err := flags.Parse(args); errors.Is(err, flag.ErrHelp) {
		_, err = fmt.Fprintln(c.out, usage)
		return err
	} else if err != nil || flags.NArg() != 0 {
		return errors.New(usage)
	}
	id, err := uuid.Parse(*plan)
	if err != nil || id == uuid.Nil {
		return errors.New("informe o UUID de um plano ativo")
	}
	operation, stop := context.WithTimeout(ctx, 2*time.Minute)
	defer stop()
	run := c.provision
	if run == nil {
		run = provisionTenant
	}
	result, err := run(operation, c.lookup, tenancy.ProvisionInput{Slug: *slug, LegalName: *name, CNPJ: *cnpj, PlanID: id})
	switch {
	case errors.Is(err, tenancy.ErrInvalid):
		return errors.New("dados da rede, plano ativo ou configuração de credenciais inválidos")
	case errors.Is(err, tenancy.ErrBusy):
		return errors.New("provisionamento em andamento; aguarde e consulte antes de repetir")
	case errors.Is(err, tenancy.ErrConflict):
		return errors.New("identidade ou recursos existentes divergem; nenhuma adoção ou substituição foi autorizada")
	case errors.Is(err, tenancy.ErrCredentialMissing):
		return errors.New("recupere a credencial original da rede; não apague nem gere outra")
	case err != nil:
		return errors.New("não foi possível confirmar o provisionamento; corrija a configuração e repita os mesmos dados, sem resetar recursos")
	}
	_, err = fmt.Fprintf(c.out, "Rede provisionada: %s; schema versão %d. Nenhum usuário final ou sessão foi criado.\n", result.ID, result.SchemaVersion)
	return err
}
func provisionTenant(ctx context.Context, lookup func(string) string, in tenancy.ProvisionInput) (tenancy.ProvisionResult, error) {
	var store tenancy.Credentials
	vault, dir := lookup("TENANT_KEYVAULT_URL"), lookup("TENANT_CREDENTIALS_DIR")
	if (vault == "") == (dir == "") {
		return tenancy.ProvisionResult{}, tenancy.ErrInvalid
	}
	var err error
	if dir != "" {
		store, err = tenancy.NewDevelopmentFiles(dir, lookup("APP_ENV") == "development")
	} else {
		store, err = tenancy.NewVault(vault, lookup("AZURE_CLIENT_ID"))
	}
	if err != nil {
		return tenancy.ProvisionResult{}, err
	}
	provisioner, err := tenancy.OpenProvisioner(ctx, lookup("PROVISION_CONTROL_DATABASE_URL"), lookup("PROVISION_ANALYTICS_DATABASE_URL"), store)
	if err != nil {
		return tenancy.ProvisionResult{}, err
	}
	defer provisioner.Close()
	return provisioner.Provision(ctx, in)
}
