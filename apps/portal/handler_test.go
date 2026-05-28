package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubCarrier struct {
	body []byte
	code int
	err  error
}

func (s *stubCarrier) Lookup(_ context.Context, _ string) ([]byte, int, error) {
	return s.body, s.code, s.err
}

func TestResolve_ProxiesCarrierResponse(t *testing.T) {
	body := []byte(`{"shipment_id":"SHP-2049-883"}`)
	c := &stubCarrier{body: body, code: 200}
	bus := NewTraceBus(8)

	r := httptest.NewRequest(http.MethodPost, "/resolve",
		strings.NewReader(`{"shipment_id":"SHP-2049-883"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handleResolve(c, bus)(w, r)

	if w.Code != 200 {
		t.Fatalf("status: %d", w.Code)
	}
	if !bytes.Equal(w.Body.Bytes(), body) {
		t.Errorf("body: %q", w.Body.String())
	}
}

func TestResolve_BadJSONReturns400(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/resolve",
		strings.NewReader(`not-json`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleResolve(&stubCarrier{}, NewTraceBus(2))(w, r)
	if w.Code != 400 {
		t.Errorf("status: %d", w.Code)
	}
}

func TestResolve_CarrierErrorReturns502(t *testing.T) {
	c := &stubCarrier{err: errCarrierDown}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/resolve",
		strings.NewReader(`{"shipment_id":"SHP-2049-883"}`))
	handleResolve(c, NewTraceBus(2))(w, r)
	if w.Code != 502 {
		t.Errorf("status: %d", w.Code)
	}
}

func TestResolve_NotPOSTReturns405(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/resolve", nil)
	handleResolve(&stubCarrier{}, NewTraceBus(2))(w, r)
	if w.Code != 405 {
		t.Errorf("status: %d", w.Code)
	}
}
