package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"time"

	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/config"
	"github.com/crmf/crmf/internal/server/httpapi"
)

type recoveryService interface {
	httpapi.RecoveryRequestBackend
	ProcessOne(context.Context) (bool, error)
	Ping(context.Context) error
}

func localRecovery(engine *auth.Engine, cfg config.Auth) (recoveryService, func(), error) {
	if cfg.RecoveryMailpitURL == "" {
		return nil, func() {}, nil
	}
	mailer, err := auth.NewLocalMailer(auth.LocalMailOptions{Development: cfg.Development, Endpoint: cfg.RecoveryMailpitURL, TenantOrigin: cfg.TenantOrigin, PlatformOrigin: cfg.PlatformOrigin})
	if err != nil {
		return nil, nil, errors.New("invalid local recovery capture configuration")
	}
	service, err := auth.NewLocalRecovery(engine, mailer)
	if err != nil {
		mailer.Close()
		return nil, nil, errors.New("initialize local recovery")
	}
	return service, mailer.Close, nil
}
func runAuthMail(ctx context.Context, logger *slog.Logger) error {
	cfg, err := config.LoadAuth(os.Getenv)
	if err != nil || !cfg.Enabled || !cfg.Development || cfg.RecoveryMailpitURL == "" {
		return errors.New("auth-mail requires explicit development capture configuration")
	}
	start, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	sessions, err := auth.Open(start, cfg.DatabaseURL)
	if err != nil {
		return errors.New("initialize authentication mail database")
	}
	defer sessions.Close()
	key, err := auth.LoadMFAKey(start, cfg)
	if err != nil {
		return errors.New("load authentication mail custody")
	}
	engine, err := auth.NewEngine(start, sessions, key, cfg.TenantOrigin, cfg.PlatformOrigin)
	clear(key)
	if err != nil {
		return errors.New("initialize authentication mail engine")
	}
	recovery, closeMail, err := localRecovery(engine, cfg)
	if err != nil {
		return err
	}
	defer closeMail()
	if err := recovery.Ping(start); err != nil {
		return errors.New("authentication recovery schema unavailable; apply reviewed migrations")
	}
	maintenanceCtx, stopMaintenance := context.WithCancel(ctx)
	defer stopMaintenance()
	go maintainAuth(maintenanceCtx, engine, logger)
	// One bounded claim per tick. Polling drives work, not retries of a claim.
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	logger.Info("development authentication mail ready; disposable identities only")
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
			bounded, stop := context.WithTimeout(ctx, 15*time.Second)
			_, err := recovery.ProcessOne(bounded)
			stop()
			if err != nil && ctx.Err() == nil {
				logger.Warn("authentication mail outcome unconfirmed; claim will not be retried")
			}
		}
	}
}
