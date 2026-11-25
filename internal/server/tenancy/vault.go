package tenancy

import (
	"context"
	"errors"
	"github.com/crmf/crmf/internal/server/config"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azsecrets"
	"github.com/google/uuid"
)

type Vault struct{ client *azsecrets.Client }

// NewVault uses managed identity only, not CLI/default credentials or files.
func NewVault(endpoint, clientID string) (*Vault, error) {
	vault, _, _, err := config.ParseVaultReference(strings.TrimSuffix(endpoint, "/") + "/secrets/tenancy/" + strings.Repeat("0", 32))
	if err != nil {
		return nil, ErrInvalid
	}
	opts := &azidentity.ManagedIdentityCredentialOptions{}
	if clientID != "" {
		opts.ID = azidentity.ClientID(clientID)
	}
	identity, err := azidentity.NewManagedIdentityCredential(opts)
	if err != nil {
		return nil, ErrUnavailable
	}
	client, err := azsecrets.NewClient(vault, identity, nil)
	if err != nil {
		return nil, ErrUnavailable
	}
	return &Vault{client: client}, nil
}
func (v *Vault) Get(ctx context.Context, id uuid.UUID, slug, version string) (Credential, error) {
	if !slugPattern.MatchString(slug) || (version != "" && !versionPattern.MatchString(version)) {
		return Credential{}, ErrInvalid
	}
	result, err := v.client.GetSecret(ctx, secretName(slug), version, nil)
	if err != nil {
		var response *azcore.ResponseError
		if errors.As(err, &response) && response.StatusCode == 404 {
			return Credential{}, ErrCredentialMissing
		}
		return Credential{}, ErrUnavailable
	}
	if result.Value == nil || result.ID == nil || result.Tags["crmf-tenant-id"] == nil {
		return Credential{}, ErrUnavailable
	}
	if result.Attributes != nil && result.Attributes.Enabled != nil && !*result.Attributes.Enabled {
		return Credential{}, ErrUnavailable
	}
	owner, err := uuid.Parse(*result.Tags["crmf-tenant-id"])
	if err != nil {
		return Credential{}, ErrUnavailable
	}
	credential := Credential{TenantID: owner, Version: result.ID.Version(), Password: *result.Value}
	if !validCredential(credential, id) || (version != "" && credential.Version != version) {
		return Credential{}, ErrConflict
	}
	return credential, nil
}
func (v *Vault) Create(ctx context.Context, id uuid.UUID, slug string) (Credential, error) {
	// Provisioner holds a cluster-wide per-slug lock. Never replace an existing
	// secret, including disabled/unreadable secrets. Keep that RBAC exclusive.
	if _, err := v.Get(ctx, id, slug, ""); !errors.Is(err, ErrCredentialMissing) {
		if err != nil {
			return Credential{}, err
		}
		return Credential{}, ErrConflict
	}
	credential, err := newCredential(id)
	if err != nil {
		return Credential{}, err
	}
	owner := id.String()
	result, err := v.client.SetSecret(ctx, secretName(slug), azsecrets.SetSecretParameters{Value: &credential.Password, Tags: map[string]*string{"crmf-tenant-id": &owner}}, nil)
	if err != nil || result.ID == nil {
		return Credential{}, ErrUnavailable
	}
	credential.Version = result.ID.Version()
	if !validCredential(credential, id) {
		return Credential{}, ErrUnavailable
	}
	return credential, nil
}
