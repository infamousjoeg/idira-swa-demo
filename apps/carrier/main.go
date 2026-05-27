package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("carrier: %v", err)
	}
}

func run() error {
	smURL := os.Getenv("PANW_SM_URL")
	if smURL == "" {
		return errors.New("PANW_SM_URL is required")
	}
	secretID := os.Getenv("CARRIER_SECRET_ID")
	if secretID == "" {
		secretID = "swa-demo/carrier/api-key"
	}
	socketPath := os.Getenv("SPIFFE_ENDPOINT_SOCKET")
	if socketPath == "" {
		// In-container default — matches the volumeMount in carrier.deployment.yaml.
		// The host's hostPath /tmp/swa-agent/public is mounted at /run/swa-agent.
		socketPath = "unix:///run/swa-agent/api.sock"
	}

	rootCtx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Bring up the Workload API client. Bail loudly if the agent socket isn't
	// there or auth fails — these are deploy-time configuration problems and
	// the demo is not useful without them.
	wlClient, err := workloadapi.New(rootCtx,
		workloadapi.WithAddr(socketPath))
	if err != nil {
		return err
	}
	defer wlClient.Close()

	bus := NewTraceBus(256)
	sm := NewSMClient(smURL)
	deps := handlerDeps{
		wl:       wlClient,
		sm:       sm,
		secretID: secretID,
		bus:      bus,
		now:      time.Now,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/lookup/", handleLookup(deps))
	mux.HandleFunc("/trace", handleTraceSSE(bus))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{
		Addr:              ":8443",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-rootCtx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
	}()

	bus.Emit(traceEvent{Source: "carrier", Type: "boot", Payload: map[string]any{
		"sm_url": smURL, "secret_id": secretID,
	}})
	log.Printf("carrier: listening on %s, socket=%s, sm=%s, secret=%s",
		srv.Addr, socketPath, smURL, secretID)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
