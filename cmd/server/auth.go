package main

import (
	"context"
	"github.com/crmf/crmf/internal/server/auth"
	"log/slog"
	"time"
)

func maintainAuth(ctx context.Context, engine *auth.Engine, logger *slog.Logger) {
	tick := time.NewTicker(5 * time.Minute)
	defer tick.Stop()
	for {
		bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := engine.PruneExpiredState(bounded)
		cancel()
		if err != nil && ctx.Err() == nil {
			logger.WarnContext(ctx, "authentication maintenance unavailable")
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
