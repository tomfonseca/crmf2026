package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/crmf/crmf/internal/server/app"
	"github.com/crmf/crmf/internal/server/auth"
	"github.com/crmf/crmf/internal/server/config"
	"github.com/crmf/crmf/internal/server/httpapi"
	"github.com/crmf/crmf/internal/server/migrate"
	"github.com/crmf/crmf/internal/server/provisionqueue"
	"github.com/crmf/crmf/internal/server/tenancy"
	"github.com/jackc/pgx/v5/pgxpool"
)

var version = "dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) error {
	if len(args) == 0 {
		return errors.New("usage: server api | worker | provisioner | migrate --scope control|platform|queue | version")
	}
	if args[0] == "version" {
		fmt.Println(version)
		return nil
	}
	if args[0] == "provisioner" {
		credentials, err := tenancy.CredentialsFromEnvironment(os.Getenv)
		if err != nil {
			return errors.New("invalid isolated provisioner credential configuration")
		}
		return provisionqueue.Run(ctx, os.Getenv("PROVISION_CONTROL_DATABASE_URL"), os.Getenv("PROVISION_ANALYTICS_DATABASE_URL"), credentials, logger, "provision")
	}
	if args[0] == "migrate" {
		flags := flag.NewFlagSet("migrate", flag.ContinueOnError)
		scope := flags.String("scope", "control", "control, platform or queue")
		if err := flags.Parse(args[1:]); err != nil {
			return fmt.Errorf("parse migration flags: %w", err)
		}
		if *scope == "queue" {
			return provisionqueue.Migrate(ctx, os.Getenv("CONTROL_DATABASE_URL"))
		}
		env := "CONTROL_DATABASE_URL"
		if *scope == "platform" {
			env = "ANALYTICS_DATABASE_URL"
		}
		return migrate.Up(ctx, os.Getenv(env), *scope)
	}
	if args[0] != "api" && args[0] != "worker" {
		return errors.New("unknown server mode")
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	control, err := pgxpool.New(ctx, cfg.ControlURL)
	if err != nil {
		return fmt.Errorf("create control pool: %w", err)
	}
	defer control.Close()
	analytics, err := pgxpool.New(ctx, cfg.AnalyticsURL)
	if err != nil {
		return fmt.Errorf("create analytics pool: %w", err)
	}
	defer analytics.Close()
	blob, err := azblob.NewClientFromConnectionString(cfg.BlobConnectionString, nil)
	if err != nil {
		return errors.New("invalid Blob Storage configuration")
	}
	probes := []httpapi.Probe{control.Ping, analytics.Ping, func(ctx context.Context) error {
		_, err := blob.ServiceClient().GetProperties(ctx, nil)
		if err != nil {
			return fmt.Errorf("probe blob storage: %w", err)
		}
		return nil
	}}
	if args[0] == "worker" {
		for _, probe := range probes {
			if err := probe(ctx); err != nil {
				return fmt.Errorf("worker dependencies: %w", err)
			}
		}
		logger.Info("foundation worker ready; job processing starts in M4", "version", version)
		<-ctx.Done()
		return nil
	}
	router := httpapi.New(probes, logger)
	if cfg.Auth.Enabled {
		startup, cancel := context.WithTimeout(ctx, 20*time.Second)
		sessions, err := auth.Open(startup, cfg.Auth.DatabaseURL)
		if err != nil {
			cancel()
			return errors.New("initialize isolated authentication database")
		}
		defer sessions.Close()
		key, err := auth.LoadMFAKey(startup, cfg.Auth)
		if err != nil {
			cancel()
			return errors.New("load authentication encryption key")
		}
		engine, err := auth.NewEngine(startup, sessions, key, cfg.Auth.TenantOrigin, cfg.Auth.PlatformOrigin)
		clear(key)
		if err != nil {
			cancel()
			return errors.New("initialize authentication engine")
		}
		catalog, err := app.NewPlanCatalog(startup, control)
		if err != nil {
			cancel()
			return errors.New("initialize restricted QG plan catalog")
		}
		networks, err := app.NewNetworks(startup, control, "provision")
		if err != nil {
			cancel()
			return errors.New("initialize restricted network catalog")
		}
		cancel()
		probes = append(probes, engine.Ping)
		router, err = httpapi.NewAuthenticated(probes, logger, httpapi.AuthOptions{Backend: engine, Plans: catalog, Networks: networks, Companies: app.NewCompanyLookup(), TenantOrigin: cfg.Auth.TenantOrigin, PlatformOrigin: cfg.Auth.PlatformOrigin, Development: cfg.Auth.Development, TrustedProxies: cfg.Auth.TrustedProxies})
		if err != nil {
			return errors.New("initialize authentication routes")
		}
		maintenanceCtx, stopMaintenance := context.WithCancel(ctx)
		defer stopMaintenance()
		go maintainAuth(maintenanceCtx, engine, logger)
	}
	server := &http.Server{Addr: cfg.Address, Handler: router, MaxHeaderBytes: 16 * 1024,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	logger.Info("api listening", "address", cfg.Address, "version", version)
	select {
	case err := <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown HTTP: %w", err)
		}
		return nil
	}
}
