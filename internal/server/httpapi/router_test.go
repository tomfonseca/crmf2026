package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthAndErrors(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	for _, tc := range []struct {
		path        string
		failing     bool
		status      int
		contentType string
	}{
		{"/healthz", true, 200, "application/json"},
		{"/readyz", false, 200, "application/json"},
		{"/readyz", true, 503, "application/problem+json"},
		{"/v1/me", false, 404, "application/problem+json"},
	} {
		t.Run(tc.path+tc.contentType, func(t *testing.T) {
			probe := func(context.Context) error {
				if tc.failing {
					return errors.New("secret-connection-string")
				}
				return nil
			}
			w := httptest.NewRecorder()
			New([]Probe{probe}, logger).ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			if w.Code != tc.status || w.Header().Get("Content-Type") != tc.contentType {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if strings.Contains(w.Body.String(), "secret-connection-string") {
				t.Fatal("dependency credentials leaked")
			}
		})
	}
}
