package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"
)

// startFakeForeignServer stands up a TLS listener whose cert chains to a CA
// that the client will NOT have in its RootCAs. The leaf SAN URI is set to
// the trust-domain-foreign URI the client must extract from the rejection.
func startFakeForeignServer(t *testing.T, foreignSANURI string) (addr string, cleanup func()) {
	t.Helper()
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "foreign-test-root"},
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(1 * time.Hour),
		IsCA:         true, KeyUsage: x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)

	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	u, _ := url.Parse(foreignSANURI)
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(1 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		URIs:         []*url.URL{u},
		// IP SAN so the verifier's hostname check passes against 127.0.0.1
		// and the rejection we trigger is the CA-unknown one, not a
		// hostname mismatch. The production Acme service in-cluster matches
		// its k8s Service DNS the same way.
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	serverCert := tls.Certificate{Certificate: [][]byte{leafDER, caDER}, PrivateKey: leafKey}

	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAnyClientCert,
		MinVersion:   tls.VersionTLS13,
	})
	if err != nil {
		t.Fatalf("tls.Listen: %v", err)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			// Force the handshake so the client gets the cert before being rejected on its side.
			_ = c.(*tls.Conn).Handshake()
			_ = c.Close()
		}
	}()
	return ln.Addr().String(), func() { _ = ln.Close() }
}

// mintClientCert returns a self-signed cert/key so the test client has SOMETHING
// to present (mirrors how the portal presents its real SWA SVID in production).
func mintClientCert(t *testing.T) tls.Certificate {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "test-client"},
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(1 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func TestExternalCarrierClient_EmitsForeignURIAndError(t *testing.T) {
	const foreignURI = "spiffe://acme.courier/carrier/parcel"
	addr, cleanup := startFakeForeignServer(t, foreignURI)
	defer cleanup()
	host, port, _ := net.SplitHostPort(addr)
	_ = port

	bus := NewTraceBus(64)
	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	client := NewExternalCarrierClient(addr, mintClientCert(t), x509.NewCertPool(), bus)
	err := client.Resolve(context.Background(), "SHP-2049-883")
	if err == nil {
		t.Fatal("Resolve returned nil err; want rejection")
	}

	// Drain the bus and assert event shape.
	got := drainBus(sub, 200*time.Millisecond)
	if !hasEvent(got, "mtls.handshake.start", "peer_host", net.JoinHostPort(host, port)) {
		t.Errorf("missing mtls.handshake.start event with peer_host; got %+v", got)
	}
	uriEv := findEvent(got, "mtls.peer_uri_seen")
	if uriEv == nil {
		t.Fatalf("missing mtls.peer_uri_seen; got %+v", got)
	}
	if uri, _ := uriEv.Payload["uri"].(string); uri != foreignURI {
		t.Errorf("peer_uri_seen.uri = %q, want %q", uri, foreignURI)
	}
	errEv := findEvent(got, "mtls.handshake.err")
	if errEv == nil {
		t.Fatalf("missing mtls.handshake.err; got %+v", got)
	}
	if msg, _ := errEv.Payload["err"].(string); !strings.Contains(msg, "unknown authority") {
		t.Errorf("handshake.err.err = %q, want contains 'unknown authority'", msg)
	}
}

func TestExternalCarrierClient_DialFailureNoCertEvent(t *testing.T) {
	// Point at a closed port. We expect a dial error, NOT a CertificateVerificationError.
	// Confirm we do NOT emit mtls.peer_uri_seen in this case -- only the err event.
	bus := NewTraceBus(64)
	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	client := NewExternalCarrierClient("127.0.0.1:1", mintClientCert(t), x509.NewCertPool(), bus)
	err := client.Resolve(context.Background(), "SHP-2049-883")
	if err == nil {
		t.Fatal("Resolve returned nil err; want connection refused")
	}
	got := drainBus(sub, 200*time.Millisecond)
	if findEvent(got, "mtls.peer_uri_seen") != nil {
		t.Errorf("unexpected mtls.peer_uri_seen on plain dial failure; got %+v", got)
	}
	if findEvent(got, "mtls.handshake.err") == nil {
		t.Errorf("missing mtls.handshake.err; got %+v", got)
	}
}

// Test helpers ---------------------------------------------------------

func drainBus(sub chan traceEvent, wait time.Duration) []traceEvent {
	var out []traceEvent
	deadline := time.After(wait)
	for {
		select {
		case ev := <-sub:
			out = append(out, ev)
		case <-deadline:
			return out
		}
	}
}

func findEvent(events []traceEvent, typ string) *traceEvent {
	for i := range events {
		if events[i].Type == typ {
			return &events[i]
		}
	}
	return nil
}

func hasEvent(events []traceEvent, typ, key, want string) bool {
	ev := findEvent(events, typ)
	if ev == nil {
		return false
	}
	got, _ := ev.Payload[key].(string)
	return got == want
}
