package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAuthnJWT_PostsFormAndReturnsBase64Token(t *testing.T) {
	const wantJWT = "eyJ.fake.jwt"
	const respToken = "dGVzdC10b2tlbg=="

	var seenForm url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/authn-jwt/secureWorkloadAccess/conjur/authenticate" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Accept-Encoding") != "base64" {
			t.Errorf("missing Accept-Encoding: base64 header")
		}
		body, _ := io.ReadAll(r.Body)
		seenForm, _ = url.ParseQuery(string(body))
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(respToken))
	}))
	defer srv.Close()

	c := NewSMClient(srv.URL)
	tok, meta, err := c.AuthnJWT(t.Context(), wantJWT)
	if err != nil {
		t.Fatalf("AuthnJWT: %v", err)
	}
	if tok != respToken {
		t.Errorf("token: got %q want %q", tok, respToken)
	}
	if seenForm.Get("jwt") != wantJWT {
		t.Errorf("body jwt: got %q want %q", seenForm.Get("jwt"), wantJWT)
	}
	if meta == nil || meta.URL == "" || meta.Method != "POST" || meta.Status != 200 {
		t.Errorf("meta missing fields: %+v", meta)
	}
}

func TestFetchSecret_AuthorizationHeaderAndPath(t *testing.T) {
	const smToken = "dGVzdC10b2tlbg=="
	const wantSecret = "carrier-api-key-2026"
	const variableID = "swa-demo/carrier/api-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Compare against RawPath (which preserves percent-encoding) not Path
		// (Go decodes %2F back to /). Conjur treats %2F inside the variable ID
		// as a literal slash within the ID -- distinct from a path separator --
		// so the client MUST send the escaped form.
		wantPath := "/api/secrets/conjur/variable/" + url.PathEscape(variableID)
		if r.URL.RawPath != wantPath {
			t.Errorf("path: got RawPath=%q Path=%q want %q", r.URL.RawPath, r.URL.Path, wantPath)
		}
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, `Token token="`) || !strings.Contains(auth, smToken) {
			t.Errorf("Authorization header: got %q", auth)
		}
		w.Write([]byte(wantSecret))
	}))
	defer srv.Close()

	c := NewSMClient(srv.URL)
	got, meta, err := c.FetchSecret(t.Context(), smToken, variableID)
	if err != nil {
		t.Fatalf("FetchSecret: %v", err)
	}
	if string(got) != wantSecret {
		t.Errorf("secret: got %q want %q", got, wantSecret)
	}
	if meta == nil || meta.Method != "GET" || meta.Status != 200 ||
		meta.SecretID != variableID || meta.Bytes != len(wantSecret) {
		t.Errorf("meta missing fields: %+v", meta)
	}
}

func TestAuthnJWT_NonOKStatusReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "denied", http.StatusUnauthorized)
	}))
	defer srv.Close()

	_, meta, err := NewSMClient(srv.URL).AuthnJWT(t.Context(), "x")
	if err == nil {
		t.Fatal("expected error on 401")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention status: %v", err)
	}
	// Meta is populated even on error so callers can log request shape.
	if meta == nil || meta.Status != 401 {
		t.Errorf("meta on error path missing status: %+v", meta)
	}
}

// TestAuthnJWT_PopulatesMetaWithTTL asserts the TTL parser extracts a
// positive TokenTTLSeconds when SM returns a realistic Conjur authentication
// envelope. The envelope format mirrors what the real SM authn-jwt endpoint
// produces: base64({"protected":"...","payload":"<b64>","signature":"..."}).
func TestAuthnJWT_PopulatesMetaWithTTL(t *testing.T) {
	// Inner payload: Conjur tokens default to 8min TTL (480s).
	payloadJSON := []byte(`{"sub":"host/swa-demo/carrier","iat":1748000000,"exp":1748000480}`)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)
	envelope := []byte(`{"protected":"hdr","payload":"` + payloadB64 + `","signature":"sig"}`)
	respToken := base64.StdEncoding.EncodeToString(envelope)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(respToken))
	}))
	defer srv.Close()

	_, meta, err := NewSMClient(srv.URL).AuthnJWT(t.Context(), "fake.jwt.sig")
	if err != nil {
		t.Fatalf("AuthnJWT: %v", err)
	}
	if meta.URL == "" {
		t.Error("URL must be populated")
	}
	if meta.Status != 200 {
		t.Errorf("status=%d, want 200", meta.Status)
	}
	if meta.TokenTTLSeconds != 480 {
		t.Errorf("TTL=%d, want 480", meta.TokenTTLSeconds)
	}
}

// Sanity: the response token from SM is opaque base64 -- we should NOT decode it.
func TestAuthnJWT_DoesNotDecodeBase64(t *testing.T) {
	const respToken = "dGVzdC10b2tlbg==" // base64 of "test-token"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(respToken))
	}))
	defer srv.Close()
	tok, _, _ := NewSMClient(srv.URL).AuthnJWT(t.Context(), "x")
	if _, err := base64.StdEncoding.DecodeString(tok); err != nil {
		t.Fatalf("returned token should still be base64-encoded; got %q", tok)
	}
	if tok != respToken {
		t.Errorf("token modified by client; got %q want %q", tok, respToken)
	}
}
