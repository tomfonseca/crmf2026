package main

import (
	"github.com/crmf/crmf/internal/server/config"
	"testing"
)

func TestDisabledRecoveryHasNoTypedNilBackend(t *testing.T) {
	service, closeMail, err := localRecovery(nil, config.Auth{})
	if err != nil || service != nil || closeMail == nil {
		t.Fatal("disabled recovery became a non-nil interface")
	}
	closeMail()
}
func TestRecoveryRefusesProductionCapture(t *testing.T) {
	_, _, err := localRecovery(nil, config.Auth{RecoveryMailpitURL: "http://localhost:18025", TenantOrigin: "https://dash.example.test", PlatformOrigin: "https://qg.example.test"})
	if err == nil {
		t.Fatal("production capture fallback accepted")
	}
}
