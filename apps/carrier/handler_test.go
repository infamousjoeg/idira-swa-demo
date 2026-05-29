package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
)

//go:embed fixture/shipments.json
var fixtureFS embed.FS

type stubJWT struct {
	err error
}

func (s stubJWT) FetchJWTSVID(_ context.Context, _ jwtsvid.Params) (*jwtsvid.SVID, error) {
	if s.err != nil {
		return nil, s.err
	}
	id, _ := spiffeid.FromString("spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier")
	// jwtsvid.SVID.token is unexported (set only via ParseAndValidate), so
	// .Marshal() will return "" on this stub. That's fine: the stub SMClient
	// ignores the JWT input string anyway.
	return &jwtsvid.SVID{ID: id, Audience: []string{"conjur"},
		Expiry: time.Now().Add(8 * time.Minute)}, nil
}

type stubSM struct {
	authnToken string
	authnErr   error
	secret     []byte
	secretErr  error
	// authnMeta + secretMeta are returned alongside the payload. Defaults
	// are filled in by the methods if left nil so existing tests don't have
	// to construct them by hand.
	authnMeta  *AuthnJWTMeta
	secretMeta *FetchSecretMeta
}

func (s *stubSM) AuthnJWT(_ context.Context, _ string) (string, *AuthnJWTMeta, error) {
	m := s.authnMeta
	if m == nil {
		m = &AuthnJWTMeta{
			URL: "https://sm.test.local/api/authn-jwt/secureWorkloadAccess/conjur/authenticate",
			Method: "POST", Status: 200, TokenTTLSeconds: 480,
			Scope: "secureWorkloadAccess/conjur",
		}
	}
	if s.authnErr != nil {
		return "", m, s.authnErr
	}
	return s.authnToken, m, nil
}
func (s *stubSM) FetchSecret(_ context.Context, _, vid string) ([]byte, *FetchSecretMeta, error) {
	m := s.secretMeta
	if m == nil {
		m = &FetchSecretMeta{
			URL: "https://sm.test.local/api/secrets/conjur/variable/" + vid,
			Method: "GET", Status: 200, SecretID: vid, PolicyScope: vid,
			Bytes: len(s.secret),
		}
	}
	if s.secretErr != nil {
		return nil, m, s.secretErr
	}
	return s.secret, m, nil
}

func newTestDeps(t *testing.T, sm smAPI, jwtErr, smErr error) handlerDeps {
	t.Helper()
	bus := NewTraceBus(16)
	loadFixturesFromFS(fixtureFS)
	return handlerDeps{
		wl:       stubJWT{err: jwtErr},
		sm:       sm,
		secretID: "swa-demo/carrier/api-key",
		bus:      bus,
		now:      func() time.Time { return time.Unix(1748000000, 0) },
		algKid:   func(string) (string, string) { return "RS256", "stub-kid" },
	}
}

func TestLookup_HappyPath(t *testing.T) {
	deps := newTestDeps(t, &stubSM{authnToken: "tok", secret: []byte("api-key")}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
	w := httptest.NewRecorder()

	handleLookup(deps)(w, req)

	if w.Code != 200 {
		t.Fatalf("status: %d body=%s", w.Code, w.Body.String())
	}
	var got map[string]any
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["shipment_id"] != "SHP-2049-883" {
		t.Errorf("shipment_id: %v", got["shipment_id"])
	}
}

func TestLookup_UnknownShipmentReturns404(t *testing.T) {
	deps := newTestDeps(t, &stubSM{authnToken: "tok", secret: []byte("api-key")}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-DOES-NOT-EXIST", nil)
	w := httptest.NewRecorder()

	handleLookup(deps)(w, req)

	if w.Code != 404 {
		t.Fatalf("status: %d body=%s", w.Code, w.Body.String())
	}
}

func TestLookup_AuthnJWTFailureReturns502AndEmitsError(t *testing.T) {
	sm := &stubSM{authnErr: errors.New("authn-jwt: 401 denied")}
	deps := newTestDeps(t, sm, nil, sm.authnErr)
	req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
	w := httptest.NewRecorder()

	// Subscribe BEFORE the handler runs. TraceBus is drop-on-slow-consumer
	// and drops events emitted while no subscribers exist — a late drainBus
	// would observe nothing. (Plan-text bug: the original drainBus subscribed
	// after handler invocation.)
	ch := deps.bus.Subscribe()
	defer deps.bus.Unsubscribe(ch)

	handleLookup(deps)(w, req)

	if w.Code != 502 {
		t.Fatalf("status: %d body=%s", w.Code, w.Body.String())
	}
	saw := drainCh(ch, 100*time.Millisecond)
	if !sawType(saw, "sm.authn_jwt") {
		t.Errorf("expected sm.authn_jwt event, got %v", typesOf(saw))
	}
}

func TestLookup_EmptySecretReturns502(t *testing.T) {
	sm := &stubSM{authnToken: "tok", secret: []byte{}}
	deps := newTestDeps(t, sm, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
	w := httptest.NewRecorder()

	handleLookup(deps)(w, req)

	if w.Code != 502 {
		t.Fatalf("expected 502 on empty secret, got %d", w.Code)
	}
}

// Helpers used in tests but not in production code.
// drainCh reads events from a pre-existing subscription until wait elapses.
// The caller MUST subscribe before triggering the producer; TraceBus drops
// events when there are no live subscribers.
func drainCh(ch <-chan traceEvent, wait time.Duration) []traceEvent {
	out := []traceEvent{}
	deadline := time.Now().Add(wait)
	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return out
			}
			out = append(out, ev)
		case <-time.After(time.Until(deadline)):
			return out
		}
		if time.Now().After(deadline) {
			return out
		}
	}
}
func sawType(evs []traceEvent, t string) bool {
	for _, e := range evs {
		if strings.HasPrefix(e.Type, t) {
			return true
		}
	}
	return false
}
func typesOf(evs []traceEvent) []string {
	out := make([]string, 0, len(evs))
	for _, e := range evs {
		out = append(out, e.Type)
	}
	return out
}

func TestLookup_EmitsAlgAndKid(t *testing.T) {
	bus := NewTraceBus(64)
	deps := newTestDeps(t, &stubSM{authnToken: "tok", secret: []byte("api-key")}, nil, nil)
	deps.bus = bus

	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	go func() {
		req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
		handleLookup(deps)(httptest.NewRecorder(), req)
	}()

	// Collect events until we see jwt_svid.issued or time out.
	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev := <-sub:
			if ev.Type != "jwt_svid.issued" {
				continue
			}
			alg, _ := ev.Payload["alg"].(string)
			kid, _ := ev.Payload["kid"].(string)
			if alg == "" {
				t.Fatalf("jwt_svid.issued missing alg; payload=%v", ev.Payload)
			}
			if kid == "" {
				t.Fatalf("jwt_svid.issued missing kid; payload=%v", ev.Payload)
			}
			return
		case <-timeout:
			t.Fatal("never saw jwt_svid.issued")
		}
	}
}

// TestEmitSMSecretFetchedOK_NeverContainsSecretValue asserts the no-leak
// discipline on the secret-fetch event: no field of the emitted payload may
// contain the actual secret bytes. The byte count is allowed (and required).
// Spec §6.2 + validator §13.4 #4.
func TestEmitSMSecretFetchedOK_NeverContainsSecretValue(t *testing.T) {
	secretValue := []byte("SUPER-SECRET-API-KEY-DO-NOT-LEAK")
	bus := NewTraceBus(64)
	deps := newTestDeps(t, &stubSM{authnToken: "tok", secret: secretValue}, nil, nil)
	deps.bus = bus

	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	go func() {
		req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
		handleLookup(deps)(httptest.NewRecorder(), req)
	}()

	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev := <-sub:
			if ev.Type != "sm.secret_fetched.ok" {
				continue
			}
			for k, v := range ev.Payload {
				if sv, ok := v.(string); ok && strings.Contains(sv, string(secretValue)) {
					t.Fatalf("field %q leaked secret value (%q)", k, sv)
				}
				if bv, ok := v.([]byte); ok && bytes.Contains(bv, secretValue) {
					t.Fatalf("field %q leaked secret bytes", k)
				}
			}
			// Required metadata fields must all be present.
			for _, k := range []string{"url", "method", "status", "secret_id", "version", "policy_scope", "bytes"} {
				if _, ok := ev.Payload[k]; !ok {
					t.Errorf("sm.secret_fetched.ok payload missing key %q", k)
				}
			}
			if got := ev.Payload["bytes"]; got != len(secretValue) {
				t.Errorf("bytes=%v, want %d", got, len(secretValue))
			}
			return
		case <-timeout:
			t.Fatal("never saw sm.secret_fetched.ok")
		}
	}
}

// TestEmitSMAuthnJWTOK_RedactsBearer asserts that no field of the emitted
// sm.authn_jwt.ok payload contains the full bearer token: only token_redacted
// is allowed to surface it (and only as the safe display form). The redaction
// is enforced at the Go wire-emission boundary in handler.go via redactBearer;
// the frontend never sees the full token. Spec §6.2 + validator §13.4 #4.
func TestEmitSMAuthnJWTOK_RedactsBearer(t *testing.T) {
	// Realistic-looking bearer: long enough that a regex scan in the smoke
	// test (Task 12) would catch any unredacted leakage.
	fullToken := "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJob3N0L3N3YS1kZW1vL2NhcnJpZXIiLCJpYXQiOjE3NDgwMDAwMDAsImV4cCI6MTc0ODAwMDQ4MH0.LONGFAKESIGNATUREFAKESIGNATURE"
	bus := NewTraceBus(64)
	deps := newTestDeps(t, &stubSM{authnToken: fullToken, secret: []byte("api-key")}, nil, nil)
	deps.bus = bus

	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	go func() {
		req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
		handleLookup(deps)(httptest.NewRecorder(), req)
	}()

	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev := <-sub:
			if ev.Type != "sm.authn_jwt.ok" {
				continue
			}
			redacted, _ := ev.Payload["token_redacted"].(string)
			if !strings.HasSuffix(redacted, "...REDACTED") {
				t.Errorf("token_redacted missing ...REDACTED marker: %q", redacted)
			}
			// Critical: full token must NOT appear in any payload field.
			for k, v := range ev.Payload {
				if sv, ok := v.(string); ok && strings.Contains(sv, fullToken) {
					t.Fatalf("field %q leaked full bearer", k)
				}
			}
			// The required metadata fields must all be present.
			for _, k := range []string{"url", "method", "status", "token_redacted", "token_ttl_seconds", "scope"} {
				if _, ok := ev.Payload[k]; !ok {
					t.Errorf("sm.authn_jwt.ok payload missing key %q", k)
				}
			}
			return
		case <-timeout:
			t.Fatal("never saw sm.authn_jwt.ok")
		}
	}
}

// TestEmitJWTSvidIssued_IncludesFullClaims asserts the M6 payload extension:
// the emitted jwt_svid.issued event must carry iss, iat, jti, typ, and raw on
// top of the M3-era aud/exp/spiffe_id/alg/kid. Spec §5 of the 2026-05-29
// flip-card-detail-view design + plan Task 2. Only key PRESENCE is checked
// here -- the stub SVID's Marshal() returns "" so the decode helpers will
// produce nil values; that's fine because we only want to fail loud when a
// key is missing from the map.
func TestEmitJWTSvidIssued_IncludesFullClaims(t *testing.T) {
	bus := NewTraceBus(64)
	deps := newTestDeps(t, &stubSM{authnToken: "tok", secret: []byte("api-key")}, nil, nil)
	deps.bus = bus

	sub := bus.Subscribe()
	defer bus.Unsubscribe(sub)

	go func() {
		req := httptest.NewRequest(http.MethodGet, "/lookup/SHP-2049-883", nil)
		handleLookup(deps)(httptest.NewRecorder(), req)
	}()

	timeout := time.After(2 * time.Second)
	for {
		select {
		case ev := <-sub:
			if ev.Type != "jwt_svid.issued" {
				continue
			}
			for _, k := range []string{"aud", "exp", "spiffe_id", "alg", "kid", "iss", "iat", "jti", "typ", "raw"} {
				if _, ok := ev.Payload[k]; !ok {
					t.Errorf("jwt_svid.issued payload missing key %q", k)
				}
			}
			return
		case <-timeout:
			t.Fatal("never saw jwt_svid.issued")
		}
	}
}

// TestDecodeJWTClaims_KnownToken asserts the decode helper round-trips a
// known JWT body segment correctly. Plan Task 2 helper coverage.
func TestDecodeJWTClaims_KnownToken(t *testing.T) {
	// header={"alg":"RS256"}, body={"iss":"swa-server","iat":1748000000,"jti":"abc"}, sig=dummy
	tok := "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJzd2Etc2VydmVyIiwiaWF0IjoxNzQ4MDAwMDAwLCJqdGkiOiJhYmMifQ.sig"
	claims := decodeJWTClaims(tok)
	if claims["iss"] != "swa-server" {
		t.Errorf("iss=%v", claims["iss"])
	}
	if claims["jti"] != "abc" {
		t.Errorf("jti=%v", claims["jti"])
	}
}

func TestParseJWTType_DefaultJWT(t *testing.T) {
	// header={"alg":"RS256","typ":"JWT"}
	tok := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.body.sig"
	if got := parseJWTType(tok); got != "JWT" {
		t.Errorf("typ=%q", got)
	}
}

func TestParseJWTHeader_KnownToken(t *testing.T) {
	// Hand-crafted: header={"alg":"RS256","kid":"abc123"} base64url, body and sig are dummies.
	tok := "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYzEyMyJ9.eyJzdWIiOiJ4In0.sig"
	alg, kid := parseJWTHeader(tok)
	if alg != "RS256" || kid != "abc123" {
		t.Errorf("alg=%q kid=%q", alg, kid)
	}
}

func TestParseJWTHeader_Garbage(t *testing.T) {
	alg, kid := parseJWTHeader("not-a-jwt")
	if alg != "" || kid != "" {
		t.Errorf("expected empty; got alg=%q kid=%q", alg, kid)
	}
}
