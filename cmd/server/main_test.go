package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

func TestInvalidMode(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	if err := run(context.Background(), []string{"unknown"}, logger); err == nil {
		t.Fatal("expected error")
	}
}
