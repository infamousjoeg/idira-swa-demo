package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLookupHandler_KnownID(t *testing.T) {
	h := lookupHandler()
	req := httptest.NewRequest(http.MethodGet, "/lookup/ACM-2049-883", nil)
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body, _ := io.ReadAll(rr.Body)
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("body is not JSON: %v (body=%q)", err, string(body))
	}
	if got["parcel_id"] != "ACM-2049-883" {
		t.Errorf("parcel_id = %v, want ACM-2049-883", got["parcel_id"])
	}
	if got["carrier_name"] != "Acme Couriers" {
		t.Errorf("carrier_name = %v, want Acme Couriers", got["carrier_name"])
	}
}

func TestLookupHandler_UnknownID(t *testing.T) {
	h := lookupHandler()
	req := httptest.NewRequest(http.MethodGet, "/lookup/UNKNOWN-1", nil)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

func TestLookupHandler_RejectsNonGET(t *testing.T) {
	h := lookupHandler()
	req := httptest.NewRequest(http.MethodPost, "/lookup/ACM-2049-883", strings.NewReader(""))
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rr.Code)
	}
}
