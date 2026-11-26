// Package config loads process configuration without logging credentials.
package config

import (
	"fmt"
	"net/url"
)

type Config struct {
	Auth                 Auth
	Address              string
	ControlURL           string
	AnalyticsURL         string
	BlobConnectionString string
}

func Load(lookup func(string) string) (Config, error) {
	c := Config{Address: lookup("HTTP_ADDR"), ControlURL: lookup("CONTROL_DATABASE_URL"),
		AnalyticsURL: lookup("ANALYTICS_DATABASE_URL"), BlobConnectionString: lookup("BLOB_CONNECTION_STRING")}
	if c.Address == "" {
		c.Address = ":8080"
	}
	for _, value := range []struct{ name, value string }{
		{"CONTROL_DATABASE_URL", c.ControlURL}, {"ANALYTICS_DATABASE_URL", c.AnalyticsURL},
		{"BLOB_CONNECTION_STRING", c.BlobConnectionString},
	} {
		if value.value == "" {
			return Config{}, fmt.Errorf("required environment variable %s is missing", value.name)
		}
	}
	for _, raw := range []string{c.ControlURL, c.AnalyticsURL} {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
			return Config{}, fmt.Errorf("invalid PostgreSQL connection URL")
		}
	}
	auth, err := LoadAuth(lookup)
	if err != nil {
		return Config{}, err
	}
	c.Auth = auth
	return c, nil
}
