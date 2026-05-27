package main

import (
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
}

func (s *stubSM) AuthnJWT(_ context.Context, _ string) (string, error) {
	return s.authnToken, s.authnErr
}
func (s *stubSM) FetchSecret(_ context.Context, _, _ string) ([]byte, error) {
	return s.secret, s.secretErr
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
