package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"embed"
	"errors"
	"fmt"
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
	serverGroup := os.Getenv("IDIRA_SERVER_GROUP")
	if serverGroup == "" {
		serverGroup = "kind-sg"
	}
	attestor := os.Getenv("IDIRA_ATTESTOR")
	if attestor == "" {
		attestor = "k8s_psat"
	}
	secretID := os.Getenv("CARRIER_SECRET_ID")
	if secretID == "" {
		secretID = "swa-demo/carrier/api-key"
	}
	socketPath := os.Getenv("SPIFFE_ENDPOINT_SOCKET")
	if socketPath == "" {
		// In-container default -- matches the volumeMount in portal.deployment.yaml.
		// The host's hostPath /tmp/swa-agent/public is mounted at /run/swa-agent.
		socketPath = "unix:///run/swa-agent/api.sock"
	}
	acmeHost := os.Getenv("ACME_HOST")
	if acmeHost == "" {
		acmeHost = "acme-carrier.acme-external.svc.cluster.local:8443"
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
	agg := newIdentityAggregator(src, carrier, identityConfig{
		ServerGroup: serverGroup,
		Attestor:    attestor,
		SecretID:    secretID,
	})

	// External path reuses the SWA trust bundle for its RootCAs.
	// Acme's cert is NOT in that bundle, so the verifier WILL reject.
	// Reusing the bundle is the whole point -- no special trust for the External path.
	bundleSet, err := src.GetX509BundleForTrustDomain(peer.TrustDomain())
	if err != nil {
		return fmt.Errorf("portal: cannot read SWA trust bundle: %w", err)
	}
	rootCAs := x509.NewCertPool()
	for _, c := range bundleSet.X509Authorities() {
		rootCAs.AddCert(c)
	}
	portalSVID, err := src.GetX509SVID()
	if err != nil {
		return fmt.Errorf("portal: cannot read X509 SVID for external client: %w", err)
	}
	// Build a tls.Certificate from the in-memory SPIFFE SVID. The leaf is at
	// index 0; any intermediates follow. PrivateKey rides along.
	clientCertChain := make([][]byte, 0, len(portalSVID.Certificates))
	for _, c := range portalSVID.Certificates {
		clientCertChain = append(clientCertChain, c.Raw)
	}
	clientCert := tls.Certificate{
		Certificate: clientCertChain,
		PrivateKey:  portalSVID.PrivateKey,
	}
	external := NewExternalCarrierClient(acmeHost, clientCert, rootCAs, bus)

	ui, err := fs.Sub(uiFS, "ui")
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(ui)))
	mux.HandleFunc("/resolve", handleResolve(carrier, external, bus))
	mux.HandleFunc("/identity", agg.handler())
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
		"server_group":   serverGroup,
		"attestor":       attestor,
		"secret_id":      secretID,
		"acme_host":      acmeHost,
	}})
	log.Printf("portal: listening on %s, carrier=%s, spiffe=%s, server_group=%s, attestor=%s, acme=%s",
		srv.Addr, carrierHost, carrierSPIFFE, serverGroup, attestor, acmeHost)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
