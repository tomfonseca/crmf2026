package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azsecrets"
	"github.com/crmf/crmf/internal/server/config"
)

func LoadMFAKey(ctx context.Context, cfg config.Auth) ([]byte, error) {
	if (cfg.KeyFile == "") == (cfg.KeyVaultSecretURL == "") {
		return nil, errors.New("exactly one MFA key source required")
	}
	if cfg.KeyFile != "" {
		if !cfg.Development {
			return nil, errors.New("MFA key files are development-only")
		}
		f, err := os.Open(cfg.KeyFile)
		if err != nil {
			return nil, errors.New("MFA key file unavailable")
		}
		defer func() { _ = f.Close() }()
		data, err := io.ReadAll(io.LimitReader(f, 257))
		if err != nil || len(data) > 256 {
			return nil, errors.New("invalid MFA key file")
		}
		return decodeMFAKey(string(data))
	}
	if _, _, _, err := config.ParseVaultReference(cfg.KeyVaultSecretURL); err != nil {
		return nil, err
	}
	options := &azidentity.ManagedIdentityCredentialOptions{}
	if cfg.ManagedIdentityClientID != "" {
		options.ID = azidentity.ClientID(cfg.ManagedIdentityClientID)
	}
	credential, err := azidentity.NewManagedIdentityCredential(options)
	if err != nil {
		return nil, errors.New("MFA managed identity unavailable")
	}
	return loadVaultKey(ctx, cfg.KeyVaultSecretURL, credential, nil)
}
func loadVaultKey(ctx context.Context, reference string, credential azcore.TokenCredential, options *azsecrets.ClientOptions) ([]byte, error) {
	vault, name, version, err := config.ParseVaultReference(reference)
	if err != nil {
		return nil, err
	}
	client, err := azsecrets.NewClient(vault, credential, options)
	if err != nil {
		return nil, errors.New("MFA Key Vault client unavailable")
	}
	response, err := client.GetSecret(ctx, name, version, nil)
	if err != nil || response.Value == nil {
		return nil, errors.New("MFA Key Vault secret unavailable")
	}
	if response.Attributes != nil && response.Attributes.Enabled != nil && !*response.Attributes.Enabled {
		return nil, errors.New("MFA Key Vault secret disabled")
	}
	return decodeMFAKey(*response.Value)
}
func decodeMFAKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	key, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || len(key) != 32 || base64.StdEncoding.EncodeToString(key) != value {
		return nil, errors.New("MFA key must be canonical base64 of 32 bytes")
	}
	return key, nil
}
