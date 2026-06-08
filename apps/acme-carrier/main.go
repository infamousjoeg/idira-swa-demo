package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("acme-carrier: %v", err)
	}
}

func run() error {
	leaf, err := mintIdentity()
	if err != nil {
		return err
	}

	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	mux := http.NewServeMux()
	mux.HandleFunc("/lookup/", lookupHandler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		// healthz is plain HTTP via a separate listener -- TLS would need a
		// client cert which kubelet probes don't carry. See below.
		w.WriteHeader(http.StatusOK)
	})

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{*leaf},
		// We accept ANY client cert. The demo tests the PORTAL's rejection
		// of US, not the other direction. Documented in apps/acme-carrier/README.md.
		ClientAuth: tls.RequireAnyClientCert,
		MinVersion: tls.VersionTLS13,
	}

	srv := &http.Server{
		Addr:              ":8443",
		Handler:           mux,
		TLSConfig:         tlsCfg,
		ReadHeaderTimeout: 5 * time.Second,
	}
	// Plain-HTTP healthz on :8444 so the kubelet readiness probe doesn't
	// need a client cert.
	healthSrv := &http.Server{
		Addr:              ":8444",
		Handler:           http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
		_ = healthSrv.Shutdown(shutdownCtx)
	}()

	go func() {
		if err := healthSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("acme-carrier: health server: %v", err)
		}
	}()

	log.Printf("acme-carrier: mTLS listening on %s; healthz on %s; SPIFFE id %s",
		srv.Addr, healthSrv.Addr, acmeSPIFFEURI)
	if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
