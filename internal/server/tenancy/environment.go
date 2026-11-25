package tenancy

func ValidSlug(slug string) bool { return slugPattern.MatchString(slug) }

// CredentialsFromEnvironment never falls back between production and local custody.
func CredentialsFromEnvironment(lookup func(string) string) (Credentials, error) {
	vault, dir := lookup("TENANT_KEYVAULT_URL"), lookup("TENANT_CREDENTIALS_DIR")
	if (vault == "") == (dir == "") {
		return nil, ErrInvalid
	}
	if dir != "" {
		return NewDevelopmentFiles(dir, lookup("APP_ENV") == "development")
	}
	return NewVault(vault, lookup("AZURE_CLIENT_ID"))
}
