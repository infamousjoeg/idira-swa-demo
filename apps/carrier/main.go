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

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
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
	// M3: only this exact SPIFFE ID is allowed to terminate mTLS on :8443
	// and subscribe to /trace on :8444. Spec §13.4 #4 (no wildcards).
	portalSPIFFE := os.Getenv("PORTAL_SPIFFE_ID")
	if portalSPIFFE == "" {
		portalSPIFFE = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal"
	}

	rootCtx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Workload API client — feeds the JWT-SVID source the handler uses
	// to talk to SM authn-jwt (unchanged from M2).
	wlClient, err := workloadapi.New(rootCtx,
		workloadapi.WithAddr(socketPath))
	if err != nil {
		return err
	}
	defer wlClient.Close()

	// X509 source — feeds the server-side mTLS config on :8443/:8444.
	// Separate from wlClient because tlsconfig.MTLSServerConfig wants an
	// x509svid.Source + x509bundle.Source, both of which X509Source satisfies.
	src, err := workloadapi.NewX509Source(rootCtx,
		workloadapi.WithClientOptions(workloadapi.WithAddr(socketPath)))
	if err != nil {
		return err
	}
	defer src.Close()

	peer, err := spiffeid.FromString(portalSPIFFE)
	if err != nil {
		return err
	}
	// AuthorizeID, never AuthorizeAny or AuthorizeMemberOf (spec §13.4 #4).
	mtlsCfg := tlsconfig.MTLSServerConfig(src, src, tlsconfig.AuthorizeID(peer))

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
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Main API server (8443) — mTLS, portal SPIFFE ID required.
	srv := &http.Server{
		Addr:              ":8443",
		Handler:           mux,
		TLSConfig:         mtlsCfg,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Trace server (8444) — separate mux, same mTLS config so only the portal
	// can subscribe. Splitting the trace endpoint to its own port lets us keep
	// /healthz on :8443 (still mTLS-gated for clients, but the kubelet probe
	// only needs to reach a TLS port, not authenticate — the readinessProbe
	// uses HTTPS in M3 and accepts the cert it can validate against the bundle).
	traceMux := http.NewServeMux()
	traceMux.HandleFunc("/trace", handleTraceSSE(bus))
	traceSrv := &http.Server{
		Addr:              ":8444",
		Handler:           traceMux,
		TLSConfig:         mtlsCfg,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := traceSrv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("carrier trace server: %v", err)
		}
	}()
	go func() {
		<-rootCtx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
		_ = traceSrv.Shutdown(shutdownCtx)
	}()

	bus.Emit(traceEvent{Source: "carrier", Type: "boot", Payload: map[string]any{
		"sm_url": smURL, "secret_id": secretID,
		"portal_spiffe": portalSPIFFE,
	}})
	log.Printf("carrier: mTLS on %s (trace %s), socket=%s, sm=%s, secret=%s, peer=%s",
		srv.Addr, traceSrv.Addr, socketPath, smURL, secretID, portalSPIFFE)
	// Empty cert/key args are correct — certs come from TLSConfig.GetCertificate.
	if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
