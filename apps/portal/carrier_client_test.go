package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
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
