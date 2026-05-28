package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

//go:embed all:ui
var uiFS embed.FS

func main() {
	if err := run(); err != nil {
		log.Fatalf("portal: %v", err)
	}
}

func run() error {
	carrierHost := os.Getenv("CARRIER_HOST")
	if carrierHost == "" {
		carrierHost = "carrier.swa-demo.svc.cluster.local"
	}
	carrierSPIFFE := os.Getenv("CARRIER_SPIFFE_ID")
	if carrierSPIFFE == "" {
		carrierSPIFFE = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
	}
	socketPath := os.Getenv("SPIFFE_ENDPOINT_SOCKET")
	if socketPath == "" {
		// In-container default — matches the volumeMount in portal.deployment.yaml.
		// The host's hostPath /tmp/swa-agent/public is mounted at /run/swa-agent.
		socketPath = "unix:///run/swa-agent/api.sock"
	}

	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// X509Source feeds both the call-path mTLS client AND the trace-path
	// mTLS client with the same SVID + bundle (see carrier_client.go).
	src, err := workloadapi.NewX509Source(ctx,
		workloadapi.WithClientOptions(workloadapi.WithAddr(socketPath)))
	if err != nil {
		return err
	}
	defer src.Close()

	peer, err := spiffeid.FromString(carrierSPIFFE)
	if err != nil {
		return err
	}
	bus := NewTraceBus(256)
	carrier := NewCarrierClient(src, carrierHost, peer, bus)

	ui, err := fs.Sub(uiFS, "ui")
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(ui)))
	mux.HandleFunc("/resolve", handleResolve(carrier, bus))
	mux.HandleFunc("/trace", handleTraceSSE(bus))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
	}()

	bus.Emit(traceEvent{Source: "portal", Type: "boot", Payload: map[string]any{
		"carrier_host":   carrierHost,
		"carrier_spiffe": carrierSPIFFE,
	}})
	log.Printf("portal: listening on %s, carrier=%s, spiffe=%s",
		srv.Addr, carrierHost, carrierSPIFFE)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
