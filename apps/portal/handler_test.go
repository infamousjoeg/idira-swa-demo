package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
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

	handleResolve(c, &stubExternal{}, bus)(w, r)

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
	handleResolve(&stubCarrier{}, &stubExternal{}, NewTraceBus(2))(w, r)
	if w.Code != 400 {
		t.Errorf("status: %d", w.Code)
	}
}

func TestResolve_CarrierErrorReturns502(t *testing.T) {
	c := &stubCarrier{err: errCarrierDown}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/resolve",
		strings.NewReader(`{"shipment_id":"SHP-2049-883"}`))
	handleResolve(c, &stubExternal{}, NewTraceBus(2))(w, r)
	if w.Code != 502 {
		t.Errorf("status: %d", w.Code)
	}
}

func TestResolve_NotPOSTReturns405(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/resolve", nil)
	handleResolve(&stubCarrier{}, &stubExternal{}, NewTraceBus(2))(w, r)
	if w.Code != 405 {
		t.Errorf("status: %d", w.Code)
	}
}

func TestResolveReq_CarrierFieldDefaultsInternal(t *testing.T) {
	// Empty carrier in the JSON body must NOT default to "" on the wire --
	// the handler must default to "internal" so existing JS clients (M1-M6)
	// that don't send a carrier field continue to hit the internal flow.
	body := strings.NewReader(`{"shipment_id":"SHP-2049-883"}`)
	req := httptest.NewRequest(http.MethodPost, "/resolve", body)
	got := decodedResolveReq(t, req.Body)
	if got.Carrier != "" {
		t.Errorf("decoded Carrier = %q, want empty (handler defaults later)", got.Carrier)
	}
}

func TestResolveReq_CarrierFieldExternal(t *testing.T) {
	body := strings.NewReader(`{"shipment_id":"SHP-2049-883","carrier":"external"}`)
	req := httptest.NewRequest(http.MethodPost, "/resolve", body)
	got := decodedResolveReq(t, req.Body)
	if got.Carrier != "external" {
		t.Errorf("decoded Carrier = %q, want external", got.Carrier)
	}
}

func decodedResolveReq(t *testing.T, body io.Reader) resolveReq {
	t.Helper()
	var r resolveReq
	if err := json.NewDecoder(body).Decode(&r); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return r
}

// stubExternal implements externalAPI for handler_test.
type stubExternal struct {
	called    bool
	shipment  string
	returnErr error
}

func (s *stubExternal) Resolve(_ context.Context, id string) error {
	s.called = true
	s.shipment = id
	return s.returnErr
}

func TestHandleResolve_DispatchesToExternal(t *testing.T) {
	bus := NewTraceBus(32)
	internal := &stubCarrier{} // existing stub from M3 tests
	external := &stubExternal{returnErr: errAcmeUntrusted}

	body := strings.NewReader(`{"shipment_id":"SHP-2049-883","carrier":"external"}`)
	req := httptest.NewRequest(http.MethodPost, "/resolve", body)
	rr := httptest.NewRecorder()
	handleResolve(internal, external, bus)(rr, req)

	if !external.called {
		t.Error("external client was not called for carrier=external")
	}
	if external.shipment != "SHP-2049-883" {
		t.Errorf("external got shipment %q, want SHP-2049-883", external.shipment)
	}
	if rr.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 (errAcmeUntrusted)", rr.Code)
	}
}

func TestHandleResolve_DefaultsToInternal(t *testing.T) {
	bus := NewTraceBus(32)
	internal := &stubCarrier{body: []byte(`{}`), code: http.StatusOK}
	external := &stubExternal{}

	body := strings.NewReader(`{"shipment_id":"SHP-2049-883"}`) // no carrier field
	req := httptest.NewRequest(http.MethodPost, "/resolve", body)
	rr := httptest.NewRecorder()
	handleResolve(internal, external, bus)(rr, req)

	if external.called {
		t.Error("external client was called for missing carrier field; should default internal")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
}
