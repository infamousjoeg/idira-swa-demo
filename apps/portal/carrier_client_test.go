package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// We can't easily test the mTLS handshake in unit tests; we test the URL
// construction and HTTP semantics by substituting a plain http.Client.
func TestLookup_URLAndBody(t *testing.T) {
	var seen string
	// Only record the /lookup path; the concurrent /trace subscription hits
	// the same server but should not displace the assertion target.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/lookup/") {
			seen = r.URL.Path
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`{"shipment_id":"SHP-2049-883"}`))
			return
		}
		// /trace — close the stream immediately so the goroutine exits cleanly.
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	c := &CarrierClient{
		baseURL:  "http://" + u.Host,
		http:     srv.Client(),
		traceURL: "http://" + u.Host + "/trace",
		bus:      NewTraceBus(8),
	}
	body, code, err := c.Lookup(context.Background(), "SHP-2049-883")
	if err != nil {
		t.Fatal(err)
	}
	if code != 200 {
		t.Errorf("code: %d", code)
	}
	if !strings.Contains(string(body), "SHP-2049-883") {
		t.Errorf("body: %s", body)
	}
	if seen != "/lookup/SHP-2049-883" {
		t.Errorf("path: %s", seen)
	}
}

func TestLookup_BadShipmentIDRejectedBeforeNetwork(t *testing.T) {
	c := &CarrierClient{baseURL: "http://invalid", http: http.DefaultClient, bus: NewTraceBus(2)}
	_, _, err := c.Lookup(context.Background(), "../etc/passwd")
	if err == nil {
		t.Fatal("expected validation error")
	}
}

func TestLookup_EmitsPeerSANURIOnHandshakeOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/lookup/") {
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`{"shipment_id":"SHP-2049-883"}`))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	bus := NewTraceBus(64)
	c := &CarrierClient{
		baseURL:  "http://" + u.Host,
		http:     srv.Client(),
		traceURL: "http://" + u.Host + "/trace",
		bus:      bus,
	}
	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	go func() { _, _, _ = c.Lookup(context.Background(), "SHP-2049-883") }()

	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev := <-sub:
			if ev.Type != "mtls.handshake.ok" {
				continue
			}
			// Plain-HTTP test server: peer_san_uri will be present as empty
			// string. The point is the payload field exists.
			if _, ok := ev.Payload["peer_san_uri"]; !ok {
				t.Fatalf("missing peer_san_uri; payload=%v", ev.Payload)
			}
			return
		case <-timeout:
			t.Fatal("never saw mtls.handshake.ok")
		}
	}
}

func TestIdentity_ParsesCarrierJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/identity" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"san_uri":"spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier",
			"not_before":"2026-05-29T12:00:00Z",
			"not_after":"2026-05-29T13:00:00Z",
			"key_alg":"RSA-2048",
			"rotation_minutes":60}`))
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	c := &CarrierClient{
		baseURL:  "http://" + u.Host,
		http:     srv.Client(),
		traceURL: "http://" + u.Host + "/trace",
		bus:      NewTraceBus(2),
	}
	// Override the host-derived identity URL for this plain-HTTP test.
	got, err := c.identityFromURL(context.Background(), srv.URL+"/identity")
	if err != nil {
		t.Fatal(err)
	}
	if got.SANURI != "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier" {
		t.Errorf("san_uri=%s", got.SANURI)
	}
	if got.KeyAlg != "RSA-2048" {
		t.Errorf("key_alg=%s", got.KeyAlg)
	}
}
