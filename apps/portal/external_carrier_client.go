package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
)

// errAcmeUntrusted signals the External path rejected its peer at the
// mTLS layer. The /resolve handler returns 502 to the browser and an
// inspector trace event explains why.
var errAcmeUntrusted = errors.New("external carrier rejected at trust boundary")

// ExternalCarrierClient performs an mTLS dial against a host that is
// intentionally OUTSIDE our trust domain. It uses Go's STANDARD verifier
// (RootCAs set, InsecureSkipVerify=false, no VerifyPeerCertificate override).
// When the dial fails with *tls.CertificateVerificationError, the client
// extracts the rejected leaf's SAN URI for honest display in the inspector.
//
// The whole module is a deliberate inversion of carrier_client.go: same
// shape, opposite expected outcome.
type ExternalCarrierClient struct {
	addr       string // host:port -- the Acme service
	clientCert tls.Certificate
	rootCAs    *x509.CertPool // portal's SWA trust bundle -- does NOT contain Acme's CA
	bus        *TraceBus
}

// NewExternalCarrierClient wires the static config. The rootCAs argument is
// the portal's existing SWA trust bundle; M7 reuses it verbatim. Nothing
// about the External path opens trust beyond what the Internal path already has.
func NewExternalCarrierClient(addr string, clientCert tls.Certificate, rootCAs *x509.CertPool, bus *TraceBus) *ExternalCarrierClient {
	return &ExternalCarrierClient{
		addr:       addr,
		clientCert: clientCert,
		rootCAs:    rootCAs,
		bus:        bus,
	}
}

// Resolve dials the external carrier, expects rejection, emits trace events,
// and returns errAcmeUntrusted on the verification failure or the raw dial
// error on a network failure.
func (c *ExternalCarrierClient) Resolve(ctx context.Context, shipmentID string) error {
	c.bus.Emit(traceEvent{
		Source:  "portal",
		Type:    "mtls.handshake.start",
		Payload: map[string]any{"peer_host": c.addr},
	})

	dialer := &tls.Dialer{
		Config: &tls.Config{
			Certificates:       []tls.Certificate{c.clientCert},
			RootCAs:            c.rootCAs,
			InsecureSkipVerify: false, // STANDARD verification; we WANT rejection
			MinVersion:         tls.VersionTLS13,
		},
	}
	conn, err := dialer.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		// If this is a CertificateVerificationError, capture the foreign URI.
		var cve *tls.CertificateVerificationError
		if errors.As(err, &cve) && len(cve.UnverifiedCertificates) > 0 {
			leaf := cve.UnverifiedCertificates[0]
			if len(leaf.URIs) > 0 {
				c.bus.Emit(traceEvent{
					Source:  "portal",
					Type:    "mtls.peer_uri_seen",
					Payload: map[string]any{"uri": leaf.URIs[0].String()},
				})
			}
		}
		c.bus.Emit(traceEvent{
			Source:  "portal",
			Type:    "mtls.handshake.err",
			Payload: map[string]any{"err": err.Error()},
		})
		if cve != nil {
			return fmt.Errorf("%w: %v", errAcmeUntrusted, err)
		}
		return err
	}
	// Successful handshake against an "external" peer is unexpected in M7.
	// Close immediately and emit a diagnostic event.
	_ = conn.Close()
	c.bus.Emit(traceEvent{
		Source:  "portal",
		Type:    "mtls.handshake.unexpected_ok",
		Payload: map[string]any{"peer_host": c.addr},
	})
	return errors.New("external carrier handshake unexpectedly succeeded (M7 expects rejection)")
}
