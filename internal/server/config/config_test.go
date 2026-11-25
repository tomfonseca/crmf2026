package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	values := map[string]string{"CONTROL_DATABASE_URL": "postgres://local:local@localhost/control",
		"ANALYTICS_DATABASE_URL": "postgres://local:local@localhost/analytics", "BLOB_CONNECTION_STRING": "test"}
	c, err := Load(func(k string) string { return values[k] })
	if err != nil || c.Address != ":8080" {
		t.Fatalf("config: %v, %v", c, err)
	}
	delete(values, "CONTROL_DATABASE_URL")
	if _, err := Load(func(k string) string { return values[k] }); err == nil {
		t.Fatal("expected missing configuration error")
	}
}
func TestInvalidURLDoesNotExposeCredentials(t *testing.T) {
	_, err := Load(func(k string) string {
		if k == "BLOB_CONNECTION_STRING" {
			return "test"
		}
		return "secret-password"
	})
	if err == nil || strings.Contains(err.Error(), "secret-password") {
		t.Fatalf("unsafe error: %v", err)
	}
}
