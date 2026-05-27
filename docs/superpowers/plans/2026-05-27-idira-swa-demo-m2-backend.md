# Idira SWA Demo — M2 Backend Identity + Secret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `carrier` Go service running in `swa-demo` namespace that, on `GET /lookup/{shipment_id}`, fetches a JWT-SVID from the local SWA Workload API (audience `conjur`), exchanges it at the SM tenant via the `secureWorkloadAccess` JWT authenticator for a short-lived SM access token, reads the variable `swa-demo/carrier/api-key`, and returns canned shipment JSON. Plus the TF resources that configure the JWT authenticator and the secret on the tenant.

**Architecture:** One Go service (`carrier`) built into a distroless image, deployed by manifests in `platform/k8s/`. Three new Terraform files (`30-jwt-authn.tf`, `40-policy.tf`, `50-secret.tf`) that constitute TF apply #2 (spec §7.2) — they configure the SM authn-jwt service-id `secureWorkloadAccess`, scope a Conjur policy to the carrier's SPIFFE ID, and create the variable holding the API key. A throwaway `portal` curl pod gives M2 a smoketest hook without needing M3's UI.

**Tech Stack:** Go 1.23, `github.com/spiffe/go-spiffe/v2` for SVID handling, distroless static base image, Terraform (resources discovered in M1 Task 6's `SCHEMA.md`), kubectl manifests (no Helm for the demo apps — overkill).

**Spec under implementation:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`. Sections referenced as §X.Y.

**Prerequisites the builder verifies in Task 0:**
- M1 is complete: `make up-m1` followed by `make smoke-m1` passes from a clean slate.
- `platform/terraform/SCHEMA.md` (from M1 Task 6) exists and lists the JWT-authenticator resource and the variable resource. Names commonly seen: `swa_authn_jwt` (or similar) and `swa_variable`. If the bundled provider uses different names, substitute them throughout M2.
- The SWA agent's Workload API socket lives on every kind node at `/tmp/swa-agent/public/api.sock` (created by the agent chart's `hostPath`). The carrier and portal Deployments mount that host path into the container at `/run/swa-agent/`, so in-pod consumers connect to `unix:///run/swa-agent/api.sock`.

---

## File structure (M2 creates)

```
apps/
  carrier/
    go.mod                              # Task 2
    go.sum                              # Task 2 (regenerated as deps land)
    main.go                             # Task 5 — bootstrap, mTLS server, trace
    handler.go                          # Task 6 — /lookup business logic
    handler_test.go                     # Task 6 — unit test (mocks SM client)
    sm_client.go                        # Task 4 — SM authn-jwt + secret fetch
    sm_client_test.go                   # Task 4 — unit test (httptest fixture)
    trace.go                            # Task 7 — in-memory bus + SSE handler
    trace_test.go                       # Task 7
    fixture/
      shipments.json                    # Task 3 — canned shipment lookup data
    Dockerfile                          # Task 8
platform/
  k8s/
    namespace.yaml                      # Task 9 — swa-demo + carrier SA
    carrier.deployment.yaml             # Task 10
    carrier.service.yaml                # Task 10
    portal-stub.yaml                    # Task 14 — minimal curl pod for M2 smoketest
  terraform/
    30-jwt-authn.tf                     # Task 11
    40-policy.tf                        # Task 12
    50-secret.tf                        # Task 13
    outputs.tf                          # MODIFY — add carrier_host_id, secret_id
scripts/
  smoke-m2.sh                           # Task 15
```

**M1 files modified by M2:** `Makefile` (add `tf-apply-app`, `build-apps`, `deploy-apps`, `smoke-m2`, `up-m2`), `platform/terraform/outputs.tf`.

---

## Methodology notes

- **Real TDD for Go.** Each Go file gets a unit test first; the test fails, then the implementation makes it pass. Tests use `httptest` (no real tenant calls in unit tests). Tenant calls happen in the integration smoke step (`scripts/smoke-m2.sh`) which exercises the full deployed binary.
- **Image tag.** Locally-built images are tagged `idira/carrier:m2` and loaded into kind via `kind load docker-image`. No registry needed.
- **mTLS deferred to M3.** M2 carrier serves plain HTTP on `:8443` (still called 8443 for path consistency with §5.1; the TLS wrap is added when the portal needs to authenticate to it in M3). The M2 smoketest uses a curl pod that hits this endpoint directly. Spec §9.1 lists mTLS as a M2/M3 boundary; this plan defers it to M3 because mTLS without a client to test against would be dead code in M2.
- **Trace SSE is built in M2** but exercised in M3. The `/trace` endpoint exists, the in-memory bus exists; M2's smoketest verifies a `GET /trace` returns at least one event during a `/lookup`.

---

## Task 0: Verify M1 state

**Files:** none.

- [ ] **Step 1: M1 smoketest from clean**

```bash
make down                     # clean slate
make up-m1                    # full M1 deploy
make smoke-m1                 # acceptance
```

Expected: `M1 smoketest PASS.` If not, stop and fix M1 before proceeding.

- [ ] **Step 2: Confirm SCHEMA.md has JWT-authn and variable resource names**

```bash
test -f platform/terraform/SCHEMA.md
grep -E '^resource: swa_' platform/terraform/SCHEMA.md
```

Expected: at minimum a JWT-authn-like resource and a `swa_variable`-like resource. If the provider uses an aggregate `swa_jwt_authenticator` resource, prefer that over five raw `swa_variable` writes (spec §16 OQ #3). If only `swa_variable` exists, use five of them (next tasks show that path).

- [ ] **Step 3: No commit.**

---

## Task 1: Make targets for M2 — skeleton

**Files:**
- Modify: `Makefile` (add `tf-apply-app`, `build-apps`, `deploy-apps` stubs; expanded in later tasks)

We add empty targets now so dependencies in subsequent task verifications resolve. Each gets real content in its own task.

- [ ] **Step 1: Append to `Makefile`**

```make
.PHONY: tf-apply-app build-apps deploy-apps smoke-m2 up-m2

# --- M2 targets (real bodies added by later M2 tasks) ---

tf-apply-app: _check-env tf-init ## Apply TF subset #2 (authn-jwt, policy, secret) — needs carrier deployed
	@echo 'tf-apply-app: stub — implemented in M2 Task 13'

build-apps: ## Build the demo app images locally
	@echo 'build-apps: stub — implemented in M2 Task 8'

deploy-apps: ## Deploy demo app manifests into swa-demo
	@echo 'deploy-apps: stub — implemented in M2 Task 10/14'

smoke-m2: ## Run M2 acceptance check
	@./scripts/smoke-m2.sh

up-m2: up-m1 build-apps deploy-apps tf-apply-app smoke-m2 ## Full M2 deploy + smoketest
	@echo 'M2 ready.'
```

- [ ] **Step 2: Verify `make help` lists them**

```bash
make help | grep -E 'tf-apply-app|build-apps|deploy-apps|smoke-m2|up-m2'
```

Expected: five matching lines.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "feat(m2): make target skeletons for tf-apply-app/build-apps/deploy-apps/smoke-m2/up-m2"
```

---

## Task 2: Initialize the Go module

**Files:**
- Create: `apps/carrier/go.mod`

- [ ] **Step 1: `go mod init`**

```bash
mkdir -p apps/carrier
cd apps/carrier
go mod init github.com/infamousjoeg/idira-swa-demo/apps/carrier
go get github.com/spiffe/go-spiffe/v2@latest
cd ../..
```

Expected: `go.mod` created with `module github.com/infamousjoeg/idira-swa-demo/apps/carrier`, `go 1.23` (or current), and `github.com/spiffe/go-spiffe/v2 vX.Y.Z` in `require`. `go.sum` is also created.

- [ ] **Step 2: Commit**

```bash
git add apps/carrier/go.mod apps/carrier/go.sum
git commit -m "feat(m2): init carrier go module with go-spiffe v2"
```

---

## Task 3: Fixture data

**Files:**
- Create: `apps/carrier/fixture/shipments.json`

- [ ] **Step 1: Create the fixture**

```json
{
  "SHP-2049-883": {
    "shipment_id": "SHP-2049-883",
    "origin": "Singapore",
    "destination": "Long Beach",
    "eta": "2026-06-09T14:00:00Z",
    "carrier_name": "Praetor Logistics"
  },
  "SHP-2049-884": {
    "shipment_id": "SHP-2049-884",
    "origin": "Rotterdam",
    "destination": "Newark",
    "eta": "2026-06-12T09:30:00Z",
    "carrier_name": "Praetor Logistics"
  },
  "SHP-2049-885": {
    "shipment_id": "SHP-2049-885",
    "origin": "Shenzhen",
    "destination": "Oakland",
    "eta": "2026-06-15T22:15:00Z",
    "carrier_name": "Praetor Logistics"
  }
}
```

- [ ] **Step 2: Validate JSON**

```bash
jq . apps/carrier/fixture/shipments.json >/dev/null && echo ok
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/carrier/fixture/shipments.json
git commit -m "feat(m2): carrier shipment fixture (3 canned records)"
```

---

## Task 4: `sm_client.go` — SM authn-jwt + secret fetch (TDD)

**Files:**
- Create: `apps/carrier/sm_client_test.go`
- Create: `apps/carrier/sm_client.go`

The client has two methods: `AuthnJWT(ctx, jwt) → smToken` and `FetchSecret(ctx, smToken, variableID) → []byte`. Tests use `httptest.NewServer` to simulate the SM endpoints.

- [ ] **Step 1: Write the failing test**

`apps/carrier/sm_client_test.go`:

```go
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
	tok, err := c.AuthnJWT(t.Context(), wantJWT)
	if err != nil {
		t.Fatalf("AuthnJWT: %v", err)
	}
	if tok != respToken {
		t.Errorf("token: got %q want %q", tok, respToken)
	}
	if seenForm.Get("jwt") != wantJWT {
		t.Errorf("body jwt: got %q want %q", seenForm.Get("jwt"), wantJWT)
	}
}

func TestFetchSecret_AuthorizationHeaderAndPath(t *testing.T) {
	const smToken = "dGVzdC10b2tlbg=="
	const wantSecret = "carrier-api-key-2026"
	const variableID = "swa-demo/carrier/api-key"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/api/secrets/conjur/variable/" + url.PathEscape(variableID)
		if r.URL.Path != wantPath {
			t.Errorf("path: got %q want %q", r.URL.Path, wantPath)
		}
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, `Token token="`) || !strings.Contains(auth, smToken) {
			t.Errorf("Authorization header: got %q", auth)
		}
		w.Write([]byte(wantSecret))
	}))
	defer srv.Close()

	c := NewSMClient(srv.URL)
	got, err := c.FetchSecret(t.Context(), smToken, variableID)
	if err != nil {
		t.Fatalf("FetchSecret: %v", err)
	}
	if string(got) != wantSecret {
		t.Errorf("secret: got %q want %q", got, wantSecret)
	}
}

func TestAuthnJWT_NonOKStatusReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "denied", http.StatusUnauthorized)
	}))
	defer srv.Close()

	_, err := NewSMClient(srv.URL).AuthnJWT(t.Context(), "x")
	if err == nil {
		t.Fatal("expected error on 401")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention status: %v", err)
	}
}

// Sanity: the response token from SM is opaque base64 — we should NOT decode it.
func TestAuthnJWT_DoesNotDecodeBase64(t *testing.T) {
	const respToken = "dGVzdC10b2tlbg==" // base64 of "test-token"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(respToken))
	}))
	defer srv.Close()
	tok, _ := NewSMClient(srv.URL).AuthnJWT(t.Context(), "x")
	if _, err := base64.StdEncoding.DecodeString(tok); err != nil {
		t.Fatalf("returned token should still be base64-encoded; got %q", tok)
	}
	if tok != respToken {
		t.Errorf("token modified by client; got %q want %q", tok, respToken)
	}
}
```

- [ ] **Step 2: Run the test — expect compile failure**

```bash
cd apps/carrier && go test ./... 2>&1 | head -10
```

Expected: `undefined: NewSMClient` (or similar). This is the failing-test state.

- [ ] **Step 3: Implement `sm_client.go`**

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SMClient calls the Secrets Manager – SaaS REST API for JWT auth and secret fetch.
// It performs zero base64 transformations on tokens.
type SMClient struct {
	baseURL string
	http    *http.Client
}

func NewSMClient(baseURL string) *SMClient {
	return &SMClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{},
	}
}

// AuthnJWT exchanges a JWT-SVID at the secureWorkloadAccess authenticator for an
// SM access token. The returned string is the response body verbatim — SM
// already base64-encodes it because of the Accept-Encoding: base64 header.
func (c *SMClient) AuthnJWT(ctx context.Context, jwtSVID string) (string, error) {
	form := url.Values{"jwt": {jwtSVID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/authn-jwt/secureWorkloadAccess/conjur/authenticate",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept-Encoding", "base64")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("authn-jwt: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(body) == 0 {
		return "", errors.New("authn-jwt: empty token")
	}
	return string(body), nil
}

// FetchSecret reads the given Conjur variable. smToken is the value returned by
// AuthnJWT; it is used verbatim in the Token header (no re-encoding).
func (c *SMClient) FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, error) {
	u := c.baseURL + "/api/secrets/conjur/variable/" + url.PathEscape(variableID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", `Token token="`+smToken+`"`)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch-secret: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/carrier && go test -v ./...
```

Expected: 4 PASS in `sm_client_test.go`.

- [ ] **Step 5: Commit**

```bash
git add apps/carrier/sm_client.go apps/carrier/sm_client_test.go apps/carrier/go.sum
git commit -m "feat(m2): carrier SMClient (authn-jwt + fetch-secret) with tests"
```

---

## Task 5: `main.go` — bootstrap (Workload API + HTTP server)

**Files:**
- Create: `apps/carrier/main.go`

`main.go` wires three things: the SPIFFE Workload API client (singleton), the HTTP handler (Task 6), and the trace bus (Task 7). It owns the socket lifecycle and signal handling. No business logic.

- [ ] **Step 1: Implement**

```go
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("carrier: %v", err)
	}
}

func run() error {
	smURL := os.Getenv("PANW_SM_URL")
	if smURL == "" {
		return errors.New("PANW_SM_URL is required")
	}
	secretID := os.Getenv("CARRIER_SECRET_ID")
	if secretID == "" {
		secretID = "swa-demo/carrier/api-key"
	}
	socketPath := os.Getenv("SPIFFE_ENDPOINT_SOCKET")
	if socketPath == "" {
		// In-container default — matches the volumeMount in carrier.deployment.yaml.
		// The host's hostPath /tmp/swa-agent/public is mounted at /run/swa-agent.
		socketPath = "unix:///run/swa-agent/api.sock"
	}

	rootCtx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Bring up the Workload API client. Bail loudly if the agent socket isn't
	// there or auth fails — these are deploy-time configuration problems and
	// the demo is not useful without them.
	wlClient, err := workloadapi.New(rootCtx,
		workloadapi.WithAddr(socketPath))
	if err != nil {
		return err
	}
	defer wlClient.Close()

	bus := NewTraceBus(256)
	sm := NewSMClient(smURL)
	deps := handlerDeps{
		wl:       wlClient,
		sm:       sm,
		secretID: secretID,
		bus:      bus,
		now:      time.Now,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/lookup/", handleLookup(deps))
	mux.HandleFunc("/trace", handleTraceSSE(bus))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{
		Addr:              ":8443",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-rootCtx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
	}()

	bus.Emit(traceEvent{Source: "carrier", Type: "boot", Payload: map[string]any{
		"sm_url": smURL, "secret_id": secretID,
	}})
	log.Printf("carrier: listening on %s, socket=%s, sm=%s, secret=%s",
		srv.Addr, socketPath, smURL, secretID)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
```

- [ ] **Step 2: Build to catch compile errors (handler/trace types are referenced but not yet defined — expect failures, defer fix to Tasks 6 and 7)**

```bash
cd apps/carrier && go build ./... 2>&1 | head -10
```

Expected: `undefined: handlerDeps`, `undefined: handleLookup`, `undefined: NewTraceBus`, `undefined: traceEvent`, `undefined: handleTraceSSE`. These will be resolved in Tasks 6 and 7.

- [ ] **Step 3: No commit yet** — main.go committed jointly with handler + trace in Task 7 once the package compiles.

---

## Task 6: `handler.go` + `handler_test.go` — /lookup business logic

**Files:**
- Create: `apps/carrier/handler.go`
- Create: `apps/carrier/handler_test.go`

The handler:
1. Parses `shipment_id` from path.
2. Calls `wl.FetchJWTSVID(ctx, audience=conjur)` — emits `jwt_svid.issued`.
3. Calls `sm.AuthnJWT(ctx, jwt)` — emits `sm.authn_jwt {ok|err}`.
4. Calls `sm.FetchSecret(ctx, token, secretID)` — emits `sm.secret_fetched {ok|err}`.
5. Uses the secret to "authorize" a lookup in `fixture/shipments.json`. (The secret is verified to be non-empty; in a real demo it would be the API key passed to a carrier API. Here it's the gate — emit `carrier.lookup ok|miss`.)
6. Returns the shipment JSON, 200, or 404 if missing.

Because `workloadapi.Client.FetchJWTSVID` is awkward to mock directly, we wrap it behind a tiny `jwtSource` interface and inject it through `handlerDeps`. Tests use a stub.

- [ ] **Step 1: Write the failing test**

`apps/carrier/handler_test.go`:

```go
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
	token string
	err   error
}

func (s stubJWT) FetchJWTSVID(_ context.Context, _ jwtsvid.Params) (*jwtsvid.SVID, error) {
	if s.err != nil {
		return nil, s.err
	}
	id, _ := spiffeid.FromString("spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier")
	return &jwtsvid.SVID{ID: id, Token: s.token, Audience: []string{"conjur"},
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
		wl:       stubJWT{token: "fake.jwt.svid", err: jwtErr},
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

	handleLookup(deps)(w, req)

	if w.Code != 502 {
		t.Fatalf("status: %d body=%s", w.Code, w.Body.String())
	}
	saw := drainBus(deps.bus, 100*time.Millisecond)
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
func drainBus(b *TraceBus, wait time.Duration) []traceEvent {
	out := []traceEvent{}
	deadline := time.Now().Add(wait)
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)
	for {
		select {
		case ev := <-ch:
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
```

- [ ] **Step 2: Implement `handler.go`**

```go
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
)

// Interfaces let main.go pass real impls and tests pass stubs.
type jwtSource interface {
	FetchJWTSVID(ctx context.Context, p jwtsvid.Params) (*jwtsvid.SVID, error)
}

type smAPI interface {
	AuthnJWT(ctx context.Context, jwtSVID string) (string, error)
	FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, error)
}

type handlerDeps struct {
	wl       jwtSource
	sm       smAPI
	secretID string
	bus      *TraceBus
	now      func() time.Time
}

// Fixture data lives in apps/carrier/fixture/. Loaded once on first use.
var (
	fixturesOnce sync.Once
	fixtures     map[string]map[string]any
)

func loadFixturesFromFS(fsys fs.FS) {
	fixturesOnce.Do(func() {
		f, err := fsys.Open(filepath.Join("fixture", "shipments.json"))
		if err != nil {
			fixtures = map[string]map[string]any{}
			return
		}
		defer f.Close()
		_ = json.NewDecoder(f).Decode(&fixtures)
	})
}

//go:embed fixture/shipments.json
var embeddedFixtures embed.FS

func handleLookup(d handlerDeps) http.HandlerFunc {
	loadFixturesFromFS(embeddedFixtures)
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/lookup/")
		if id == "" || strings.Contains(id, "/") {
			http.Error(w, "bad shipment id", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		d.bus.Emit(traceEvent{Source: "carrier", Type: "request.received",
			Payload: map[string]any{"id": id}})

		svid, err := d.wl.FetchJWTSVID(ctx, jwtsvid.Params{Audience: "conjur"})
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "jwt_svid.error",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "agent unreachable", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "jwt_svid.issued",
			Payload: map[string]any{"aud": "conjur", "exp": svid.Expiry.Unix(),
				"spiffe_id": svid.ID.String()}})

		smTok, err := d.sm.AuthnJWT(ctx, svid.Marshal())
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.err",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "identity rejected", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.ok",
			Payload: map[string]any{"token_len": len(smTok)}})

		secret, err := d.sm.FetchSecret(ctx, smTok, d.secretID)
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.err",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "policy denies access", http.StatusBadGateway)
			return
		}
		if len(secret) == 0 {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.empty"})
			http.Error(w, "empty secret", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.ok",
			Payload: map[string]any{"bytes": len(secret)}})

		row, ok := fixtures[id]
		if !ok {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "carrier.lookup.miss",
				Payload: map[string]any{"id": id}})
			http.Error(w, "shipment not found", http.StatusNotFound)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "carrier.lookup.ok",
			Payload: map[string]any{"id": id}})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(row)
	}
}

// svid.Marshal is provided by jwtsvid.SVID; this var lets us silence "unused import" warnings
// if a future refactor temporarily drops the helper.
var _ = errors.New
```

`handler.Marshal` is the jwtsvid.SVID method that returns the raw signed JWT string — the value to POST to SM.

- [ ] **Step 3: Run tests**

```bash
cd apps/carrier && go test -v ./...
```

Expected: `sm_client_test.go` 4 PASS + `handler_test.go` 4 PASS = 8 PASS. If the trace types referenced in the tests are still undefined, the test file won't compile — the next task (Task 7) creates `trace.go` and `traceEvent` / `TraceBus`. **In TDD discipline, we should write trace first** — re-order Tasks 6 and 7 if you want strict TDD-fail-then-pass. The plan keeps logical reading order (handler exercises trace, trace is its own concern) and accepts a one-task-delayed test run; the trade-off is documented.

- [ ] **Step 4: No commit yet** (depends on Task 7 for tests to pass).

---

## Task 7: `trace.go` + `trace_test.go` — in-memory bus + SSE handler

**Files:**
- Create: `apps/carrier/trace.go`
- Create: `apps/carrier/trace_test.go`

- [ ] **Step 1: Write the failing test**

`apps/carrier/trace_test.go`:

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBus_SubscribeReceivesEmittedEvents(t *testing.T) {
	b := NewTraceBus(4)
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	b.Emit(traceEvent{Source: "carrier", Type: "x.y", Payload: map[string]any{"k": "v"}})

	select {
	case ev := <-ch:
		if ev.Type != "x.y" {
			t.Errorf("type: %s", ev.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("no event received")
	}
}

func TestBus_SlowConsumerDoesNotBlockEmit(t *testing.T) {
	b := NewTraceBus(2) // tiny buffer
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	// Fill the buffer + 2 extra. Emit must not block.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 5; i++ {
			b.Emit(traceEvent{Type: "x"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Emit blocked on slow consumer")
	}
}

func TestSSE_EmitsDataFramesAsJSON(t *testing.T) {
	b := NewTraceBus(16)
	srv := httptest.NewServer(handleTraceSSE(b))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("content-type: %s", got)
	}

	go func() {
		time.Sleep(50 * time.Millisecond)
		b.Emit(traceEvent{Source: "carrier", Type: "boot"})
	}()

	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	frame := string(buf[:n])
	if !strings.HasPrefix(frame, "data: ") {
		t.Fatalf("expected data frame, got %q", frame)
	}
	// Strip "data: " prefix and "\n\n" suffix and ensure it parses as our event JSON.
	payload := strings.TrimSpace(strings.TrimPrefix(frame, "data: "))
	var ev map[string]any
	if err := json.NewDecoder(bytes.NewReader([]byte(payload))).Decode(&ev); err != nil {
		t.Fatalf("decode SSE frame: %v frame=%q", err, frame)
	}
	if ev["type"] != "boot" {
		t.Errorf("type in frame: %v", ev["type"])
	}
}
```

- [ ] **Step 2: Implement `trace.go`**

```go
package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type traceEvent struct {
	TS      time.Time      `json:"ts"`
	Source  string         `json:"source"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload,omitempty"`
}

// TraceBus is a fan-out, drop-on-slow-consumer event bus.
type TraceBus struct {
	mu      sync.Mutex
	subs    map[chan traceEvent]struct{}
	bufSize int
}

func NewTraceBus(bufSize int) *TraceBus {
	if bufSize < 1 {
		bufSize = 1
	}
	return &TraceBus{
		subs:    map[chan traceEvent]struct{}{},
		bufSize: bufSize,
	}
}

func (b *TraceBus) Subscribe() chan traceEvent {
	ch := make(chan traceEvent, b.bufSize)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *TraceBus) Unsubscribe(ch chan traceEvent) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *TraceBus) Emit(ev traceEvent) {
	if ev.TS.IsZero() {
		ev.TS = time.Now().UTC()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		// Non-blocking: drop on slow consumer. SSE clients reconnect.
		select {
		case ch <- ev:
		default:
		}
	}
}

func handleTraceSSE(b *TraceBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		ch := b.Subscribe()
		defer b.Unsubscribe(ch)

		for {
			select {
			case ev, ok := <-ch:
				if !ok {
					return
				}
				body, _ := json.Marshal(ev)
				_, _ = w.Write([]byte("data: "))
				_, _ = w.Write(body)
				_, _ = w.Write([]byte("\n\n"))
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}
}
```

- [ ] **Step 3: Run the full test suite — expect PASS**

```bash
cd apps/carrier && go test -v ./...
```

Expected: all tests from Task 4, 6, and 7 PASS (~11 PASS).

- [ ] **Step 4: Build the binary to confirm `main.go` compiles**

```bash
cd apps/carrier && go build -o /tmp/carrier . && /tmp/carrier 2>&1 | head -3
```

Expected: build succeeds. Running it without env errors out with `carrier: PANW_SM_URL is required` — that's the bootstrap guard from `main.go`.

- [ ] **Step 5: Commit**

```bash
git add apps/carrier/main.go apps/carrier/handler.go apps/carrier/handler_test.go \
        apps/carrier/trace.go apps/carrier/trace_test.go apps/carrier/go.sum
git commit -m "feat(m2): carrier main, /lookup handler, trace bus + SSE with tests"
```

---

## Task 8: `Dockerfile` + `build-apps` Make target

**Files:**
- Create: `apps/carrier/Dockerfile`
- Modify: `Makefile` (replace `build-apps` stub from Task 1)

- [ ] **Step 1: `apps/carrier/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -trimpath -ldflags='-s -w' -o /out/carrier .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/carrier /carrier
USER 65532:65532
EXPOSE 8443
ENTRYPOINT ["/carrier"]
```

- [ ] **Step 2: Replace the `build-apps` stub in Makefile**

```make
build-apps: ## Build the demo app images locally and load into kind
	docker build -t idira/carrier:m2 apps/carrier/
	kind load docker-image idira/carrier:m2 --name $(KIND_CLUSTER)
```

- [ ] **Step 3: Run it**

```bash
make build-apps
```

Expected: docker build succeeds (~1-2 min first time, cached after), `kind load` reports `Image: "idira/carrier:m2" with ID "sha256:…" not yet present on node "$KIND_CLUSTER-control-plane", loading…`.

- [ ] **Step 4: Verify image is in the cluster**

```bash
docker exec ${KIND_CLUSTER:-swa}-control-plane crictl images | grep carrier
```

Expected: `docker.io/idira/carrier   m2   ...`.

- [ ] **Step 5: Commit**

```bash
git add apps/carrier/Dockerfile Makefile
git commit -m "feat(m2): carrier dockerfile + build-apps make target (distroless static)"
```

---

## Task 9: `swa-demo` namespace + carrier ServiceAccount

**Files:**
- Create: `platform/k8s/namespace.yaml`

- [ ] **Step 1: Create the manifest**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: swa-demo
  labels:
    app.kubernetes.io/part-of: idira-swa-demo
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: carrier
  namespace: swa-demo
```

The carrier's SPIFFE ID derives from the ServiceAccount name via the node-group template configured in M1 Task 8 (`workload_id_template = spiffe://idira.demo/kind-ng/ns/{{.NamespaceName}}/sa/{{.ServiceAccountName}}`). So this SA being named `carrier` is what makes the SPIFFE ID `spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier`.

- [ ] **Step 2: Apply**

```bash
kubectl apply -f platform/k8s/namespace.yaml
kubectl -n swa-demo get sa
```

Expected: `carrier` ServiceAccount listed.

- [ ] **Step 3: Commit**

```bash
git add platform/k8s/namespace.yaml
git commit -m "feat(m2): swa-demo namespace + carrier service account"
```

---

## Task 10: Carrier Deployment + Service

**Files:**
- Create: `platform/k8s/carrier.deployment.yaml`
- Create: `platform/k8s/carrier.service.yaml`
- Modify: `Makefile` (`deploy-apps` to apply them)

- [ ] **Step 1: `carrier.deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: carrier
  namespace: swa-demo
  labels: {app: carrier}
spec:
  replicas: 1
  selector: {matchLabels: {app: carrier}}
  template:
    metadata:
      labels: {app: carrier}
    spec:
      serviceAccountName: carrier
      containers:
        - name: carrier
          image: idira/carrier:m2
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8443
              name: http
          env:
            - name: PANW_SM_URL
              valueFrom:
                configMapKeyRef: {name: carrier-config, key: sm_url}
            - name: CARRIER_SECRET_ID
              valueFrom:
                configMapKeyRef: {name: carrier-config, key: secret_id}
            - name: SPIFFE_ENDPOINT_SOCKET
              value: unix:///run/swa-agent/api.sock
          volumeMounts:
            - name: swa-agent-socket
              mountPath: /run/swa-agent
              readOnly: true
          readinessProbe:
            httpGet: {path: /healthz, port: http}
            initialDelaySeconds: 2
            periodSeconds: 5
      volumes:
        - name: swa-agent-socket
          hostPath:
            path: /tmp/swa-agent/public
            type: Directory
```

- [ ] **Step 2: `carrier.service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: carrier
  namespace: swa-demo
spec:
  selector: {app: carrier}
  ports:
    - port: 8443
      targetPort: 8443
      name: http
```

- [ ] **Step 3: Replace `deploy-apps` Make target body**

```make
deploy-apps: ## Deploy the demo app manifests into swa-demo
	kubectl apply -f platform/k8s/namespace.yaml
	@kubectl -n swa-demo create configmap carrier-config \
	  --from-literal=sm_url=$(PANW_SM_URL) \
	  --from-literal=secret_id=swa-demo/carrier/api-key \
	  --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f platform/k8s/carrier.deployment.yaml
	kubectl apply -f platform/k8s/carrier.service.yaml
	kubectl -n swa-demo rollout status deploy/carrier --timeout=2m
```

- [ ] **Step 4: Run it**

```bash
make deploy-apps
```

Expected: namespace + SA + configmap + deployment + service applied; rollout completes within 30s.

- [ ] **Step 5: Verify carrier is up but unable to reach SM yet (no JWT authenticator configured)**

```bash
kubectl -n swa-demo get pods
kubectl -n swa-demo logs deploy/carrier --tail=10
```

Expected: pod is `Running`, log shows the `boot` line and `listening on :8443`. Hitting `/lookup` would fail at the SM authn-jwt step (next task fixes that).

- [ ] **Step 6: Commit**

```bash
git add platform/k8s/carrier.deployment.yaml platform/k8s/carrier.service.yaml Makefile
git commit -m "feat(m2): carrier deployment + service + deploy-apps make target"
```

---

## Task 11: `30-jwt-authn.tf` — SM JWT authenticator (spec §6.3, §7.1)

**Files:**
- Create: `platform/terraform/30-jwt-authn.tf`

The spec §6.3 table lists five Conjur-style variables the JWT authenticator needs. If `SCHEMA.md` (M1 Task 6) shows an aggregate resource like `swa_jwt_authenticator`, use that. If only `swa_variable` exists, set the five via five resources under `conjur/authn-jwt/secureWorkloadAccess/`. This plan writes the aggregate path first with a fallback note.

- [ ] **Step 1: Decide aggregate-vs-five-variables based on `SCHEMA.md`**

```bash
grep -E '^resource: swa_(authn|jwt|variable)' platform/terraform/SCHEMA.md
```

If you see `resource: swa_jwt_authenticator` (or similar with `jwt_authenticator` in the name), use the aggregate version (Step 2a). If you only see `swa_variable`, use the five-variables version (Step 2b).

- [ ] **Step 2a: Aggregate `swa_jwt_authenticator`** (if available)

`platform/terraform/30-jwt-authn.tf`:

```hcl
# 30-jwt-authn.tf — Configure the SM JWT authenticator service-id
# `secureWorkloadAccess` to accept JWT-SVIDs minted by SWA for this trust domain.
# Variables sourced from spec §6.3 table; SWA publishes a per-trust-domain JWKS.

resource "swa_jwt_authenticator" "swa" {
  service_id          = "secureWorkloadAccess"
  trust_domain        = swa_trust_domain.idira.name
  jwks_uri            = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}/.well-known/jwks"
  issuer              = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}"
  token_app_property  = "sub"
  identity_path       = "data/swa/trust-domains/${var.trust_domain}/workloads"
  audience            = "conjur"
}
```

Add `var.sm_url` to `variables.tf`:

```hcl
variable "sm_url" {
  description = "Secrets Manager – SaaS base URL (no trailing slash)."
  type        = string
}
```

The Make target (`tf-apply-app`, Task 13) will pass this via `-var sm_url=$(PANW_SM_URL)`.

- [ ] **Step 2b: Five `swa_variable` resources** (only if the aggregate isn't available)

```hcl
# 30-jwt-authn.tf — five Conjur variables that configure authn-jwt/secureWorkloadAccess.
locals {
  authn_jwt_base = "conjur/authn-jwt/secureWorkloadAccess"
}

resource "swa_variable" "jwt_jwks_uri" {
  id    = "${local.authn_jwt_base}/jwks-uri"
  value = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}/.well-known/jwks"
}
resource "swa_variable" "jwt_issuer" {
  id    = "${local.authn_jwt_base}/issuer"
  value = "${var.sm_url}/api/swa/trust-domains/${var.trust_domain}"
}
resource "swa_variable" "jwt_tokenappprop" {
  id    = "${local.authn_jwt_base}/token-app-property"
  value = "sub"
}
resource "swa_variable" "jwt_identitypath" {
  id    = "${local.authn_jwt_base}/identity-path"
  value = "data/swa/trust-domains/${var.trust_domain}/workloads"
}
resource "swa_variable" "jwt_audience" {
  id    = "${local.authn_jwt_base}/audience"
  value = "conjur"
}
```

(The attribute name may be `name` or `path` instead of `id` — substitute against `SCHEMA.md`.)

- [ ] **Step 3: `terraform validate`**

```bash
terraform -chdir=platform/terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add platform/terraform/30-jwt-authn.tf platform/terraform/variables.tf
git commit -m "feat(m2): tf 30-jwt-authn — sm jwt authenticator (secureWorkloadAccess)"
```

---

## Task 12: `40-policy.tf` — SM policy scoped to carrier SPIFFE ID

**Files:**
- Create: `platform/terraform/40-policy.tf`

Policy: declare a host whose ID = the carrier's SPIFFE ID, make it a consumer of `authn-jwt/secureWorkloadAccess`, and grant `read` on the one variable. The exact resource for "load policy" depends on the bundled provider; common shapes: a `swa_policy` resource with `body` HCL/YAML, or several `swa_*_role`/`swa_*_grant` resources. Discovery via `SCHEMA.md`.

- [ ] **Step 1: Check `SCHEMA.md` for a policy resource**

```bash
grep -E '^resource: swa_(policy|host|role|grant|grant_role|permission)' platform/terraform/SCHEMA.md
```

- [ ] **Step 2a: Aggregate `swa_policy` (loadable body)** (if available)

```hcl
# 40-policy.tf — Conjur policy scoped to the carrier workload's SPIFFE ID.
# Loads under data/swa/trust-domains/idira.demo/workloads (the identity-path
# configured on the JWT authenticator in 30-jwt-authn.tf).

locals {
  carrier_spiffe_id = "spiffe://${var.trust_domain}/${var.node_group}/ns/swa-demo/sa/carrier"
  secret_branch     = "swa-demo/carrier"
}

resource "swa_policy" "carrier" {
  branch = "data/swa/trust-domains/${var.trust_domain}/workloads"
  body = <<-YAML
    - !host
      id: ${local.carrier_spiffe_id}
      annotations:
        description: "Idira SWA demo carrier service"

    - !grant
      role: !group conjur/authn-jwt/secureWorkloadAccess/consumers
      member: !host ${local.carrier_spiffe_id}

    - !permit
      role: !host ${local.carrier_spiffe_id}
      privileges: [ read, execute ]
      resource: !variable ${local.secret_branch}/api-key
  YAML
}
```

- [ ] **Step 2b: Discrete grants** (fallback if no `swa_policy` resource)

```hcl
# 40-policy.tf — discrete grants (no aggregate policy resource available).

locals {
  carrier_spiffe_id = "spiffe://${var.trust_domain}/${var.node_group}/ns/swa-demo/sa/carrier"
}

resource "swa_host" "carrier" {
  id = local.carrier_spiffe_id
}

resource "swa_grant" "carrier_consumer" {
  role   = "group:conjur/authn-jwt/secureWorkloadAccess/consumers"
  member = "host:${local.carrier_spiffe_id}"
}

resource "swa_permit" "carrier_reads_apikey" {
  role       = "host:${local.carrier_spiffe_id}"
  resource   = "variable:swa-demo/carrier/api-key"
  privileges = ["read", "execute"]
}
```

Substitute the actual resource and attribute names from `SCHEMA.md`.

- [ ] **Step 3: Validate**

```bash
terraform -chdir=platform/terraform validate
```

Expected: `Success!`. If a referenced resource doesn't exist, fall back to the other branch in Step 2.

- [ ] **Step 4: Commit**

```bash
git add platform/terraform/40-policy.tf
git commit -m "feat(m2): tf 40-policy — scope carrier spiffe id to one secret"
```

---

## Task 13: `50-secret.tf` + `tf-apply-app` Make target

**Files:**
- Create: `platform/terraform/50-secret.tf`
- Modify: `platform/terraform/outputs.tf` (add `carrier_secret_id`, `carrier_host_id`)
- Modify: `Makefile` (replace `tf-apply-app` stub)

- [ ] **Step 1: `50-secret.tf`** (using `swa_variable`; substitute attribute names against `SCHEMA.md`)

```hcl
# 50-secret.tf — the actual secret value the carrier reads.
# Value generated by Terraform's `random_password` so each `make up` rotates it.

terraform {
  required_providers {
    random = { source = "hashicorp/random" }
  }
}

resource "random_password" "carrier_api_key" {
  length  = 32
  special = false
  keepers = {
    # Rotate when the carrier SPIFFE ID changes (i.e., when the node group is renamed).
    rotate_on = var.node_group
  }
}

resource "swa_variable" "carrier_api_key" {
  id    = "swa-demo/carrier/api-key"
  value = random_password.carrier_api_key.result

  # Ensure policy is in place first (the variable lives under the policy's branch).
  depends_on = [swa_policy.carrier]   # or the discrete grants from 40-policy.tf path b
}
```

If using path 2b in Task 12 (no `swa_policy`), change `depends_on` to `[swa_permit.carrier_reads_apikey]`.

- [ ] **Step 2: Modify `outputs.tf`** (append)

```hcl
output "carrier_host_id" {
  description = "SPIFFE ID of the carrier workload (matches host in policy)."
  value       = "spiffe://${var.trust_domain}/${var.node_group}/ns/swa-demo/sa/carrier"
}

output "carrier_secret_id" {
  description = "The Conjur variable ID containing the carrier API key."
  value       = swa_variable.carrier_api_key.id
}
```

- [ ] **Step 3: Replace `tf-apply-app` Make target body**

```make
tf-apply-app: _check-env tf-init ## Apply TF subset #2: jwt authn + policy + secret
	@$(SUMMON) -- bash -c 'CONJUR_APPLIANCE_URL=$(PANW_SM_URL) CONJUR_AUTHN_TOKEN=$$(./scripts/get-sm-token.sh) $(TF) apply -auto-approve -var sm_url=$(PANW_SM_URL)'
	@$(TF) output -json | jq -r '"carrier_secret_id = " + .carrier_secret_id.value'
```

(No `-target` — by the second apply we want everything reconciled. The first apply (`tf-apply-platform`) used `-target` to limit scope; the second is a full apply.)

- [ ] **Step 4: Init (with the new random provider) and apply**

```bash
make tf-init
make tf-apply-app
```

Expected: TF plans 4–7 new resources depending on which Step 2 path was taken; applies successfully. Prints `carrier_secret_id = swa-demo/carrier/api-key`.

- [ ] **Step 5: Verify secret exists in the tenant**

```bash
eval "$(make tf-token)"
http=$(curl -s -o /dev/null -w '%{http_code}' \
  "$CONJUR_APPLIANCE_URL/api/secrets/conjur/variable/swa-demo%2Fcarrier%2Fapi-key" \
  -H "Authorization: Token token=\"$CONJUR_AUTHN_TOKEN\"")
echo "secret HTTP: $http"
```

Expected: `200` (operator token has admin scope, so it can read; carrier proves it can read via JWT in next task).

- [ ] **Step 6: Commit**

```bash
git add platform/terraform/50-secret.tf platform/terraform/outputs.tf Makefile
git commit -m "feat(m2): tf 50-secret + tf-apply-app target (random-generated api key)"
```

---

## Task 14: Portal-stub pod for M2 smoketest (deferred-to-M3 portal replaced)

**Files:**
- Create: `platform/k8s/portal-stub.yaml`
- Modify: `Makefile` (`deploy-apps` to also apply this)

For M2, we don't have the real `portal` — that's M3. To smoketest carrier from within the cluster (so DNS for `carrier.swa-demo.svc.cluster.local` resolves), deploy a tiny `curl`+`sleep` pod under the `portal` ServiceAccount name. M3 replaces this with the real portal Deployment.

- [ ] **Step 1: Create the stub**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: portal
  namespace: swa-demo
---
apiVersion: v1
kind: Pod
metadata:
  name: portal-stub
  namespace: swa-demo
  labels: {app: portal-stub}
spec:
  serviceAccountName: portal
  containers:
    - name: curl
      image: curlimages/curl:8.10.1
      command: ["sleep", "infinity"]
  restartPolicy: Always
```

- [ ] **Step 2: Extend `deploy-apps` to include it**

```make
deploy-apps: ## Deploy the demo app manifests into swa-demo
	kubectl apply -f platform/k8s/namespace.yaml
	@kubectl -n swa-demo create configmap carrier-config \
	  --from-literal=sm_url=$(PANW_SM_URL) \
	  --from-literal=secret_id=swa-demo/carrier/api-key \
	  --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -f platform/k8s/carrier.deployment.yaml
	kubectl apply -f platform/k8s/carrier.service.yaml
	kubectl apply -f platform/k8s/portal-stub.yaml
	kubectl -n swa-demo rollout status deploy/carrier --timeout=2m
	kubectl -n swa-demo wait --for=condition=Ready pod/portal-stub --timeout=60s
```

- [ ] **Step 3: Apply and verify**

```bash
make deploy-apps
kubectl -n swa-demo get pods
```

Expected: `carrier-…` Running 1/1, `portal-stub` Running 1/1.

- [ ] **Step 4: Commit**

```bash
git add platform/k8s/portal-stub.yaml Makefile
git commit -m "feat(m2): portal-stub curl pod for in-cluster smoketest (replaced by m3 portal)"
```

---

## Task 15: M2 smoketest (spec §14.2)

**Files:**
- Create: `scripts/smoke-m2.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# smoke-m2.sh — M2 acceptance check (spec §14.2).
set -euo pipefail

ns=swa-demo
fail=0
step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
err()  { printf '  [FAIL] %s\n' "$*"; fail=$((fail+1)); }

step 'carrier deployment ready'
ready=$(kubectl -n $ns get deploy carrier -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
[[ "$ready" == "1" ]] && ok "readyReplicas=1" || err "readyReplicas=$ready"

step 'portal-stub pod ready'
phase=$(kubectl -n $ns get pod portal-stub -o jsonpath='{.status.phase}' 2>/dev/null || echo missing)
[[ "$phase" == "Running" ]] && ok "Running" || err "$phase"

step 'portal-stub can reach carrier and resolve a shipment'
out=$(kubectl -n $ns exec portal-stub -- curl -sf --max-time 15 \
  http://carrier.swa-demo.svc.cluster.local:8443/lookup/SHP-2049-883 2>&1) \
  || { err "curl failed: $out"; out=''; }
if echo "$out" | jq -e '.shipment_id == "SHP-2049-883"' >/dev/null 2>&1; then
  ok 'shipment JSON returned with expected id'
else
  err "unexpected body: $out"
fi

step 'carrier logs show full happy path (jwt → authn → secret → lookup)'
logs=$(kubectl -n $ns logs deploy/carrier --tail=200)
for evt in 'jwt_svid.issued' 'sm.authn_jwt.ok' 'sm.secret_fetched.ok' 'carrier.lookup.ok'; do
  if echo "$logs" | grep -q "$evt"; then ok "saw $evt"; else err "missing $evt"; fi
done

step 'error path: 404 on unknown shipment'
http=$(kubectl -n $ns exec portal-stub -- curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  http://carrier.swa-demo.svc.cluster.local:8443/lookup/SHP-DOES-NOT-EXIST)
[[ "$http" == "404" ]] && ok "404 on miss" || err "got $http"

step 'unit tests still pass'
( cd apps/carrier && go test ./... >/dev/null 2>&1 ) && ok 'go test ./...' || err 'unit tests failed'

echo
if (( fail == 0 )); then
  echo 'M2 smoketest PASS.'
  exit 0
else
  echo "M2 smoketest FAIL ($fail check(s) failed)."
  exit 1
fi
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x scripts/smoke-m2.sh
make smoke-m2
```

Expected: every step `[ok]`, final line `M2 smoketest PASS.`, exit 0.

If `sm.authn_jwt.ok` is missing and `sm.authn_jwt.err` appears with `401`:
- The JWT-SVID is EC-signed (M1 RSA override didn't take). Inspect `apps/carrier` logs for the error body — if it mentions `algorithm` or `EC`, go back to M1 Task 15 and try a different enum string.
- The `sub` claim doesn't match the carrier's host in policy. Confirm the SPIFFE ID emitted in `jwt_svid.issued` payload matches `carrier_host_id` output.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-m2.sh
git commit -m "feat(m2): smoke-m2 acceptance check (happy path + 404 + log assertions)"
```

---

## Task 16: Wire `up-m2` and confirm `make down` cleans M2 state

**Files:**
- Modify: `Makefile` (`up-m2` already exists from Task 1; verify it works)

- [ ] **Step 1: Confirm `up-m2` runs the right chain**

```bash
grep -A1 '^up-m2:' Makefile
```

Expected: `up-m2: up-m1 build-apps deploy-apps tf-apply-app smoke-m2`.

- [ ] **Step 2: Full clean → up → down cycle**

```bash
make down
make up-m2
make down
```

Expected: `up-m2` completes with `M2 smoketest PASS.`; `down` removes the cluster + all TF state.

- [ ] **Step 3: Verify TF state is empty after down**

```bash
terraform -chdir=platform/terraform state list | wc -l | tr -d ' '
```

Expected: `0`. If non-zero, manually destroy whatever's left.

- [ ] **Step 4: Verify the random_password resource isn't accidentally orphaning the secret on the tenant**

```bash
eval "$(make tf-token)"
http=$(curl -s -o /dev/null -w '%{http_code}' \
  "$CONJUR_APPLIANCE_URL/api/secrets/conjur/variable/swa-demo%2Fcarrier%2Fapi-key" \
  -H "Authorization: Token token=\"$CONJUR_AUTHN_TOKEN\"")
echo "secret HTTP after down: $http"
```

Expected: `404` (or `403` if the host scope is also gone — both indicate the secret is gone or unreachable).

- [ ] **Step 5: No commit (verification only).**

---

## M2 done — handoff to M3

Once Task 16 verifies clean teardown, M2 is complete. Validator subagent (spec §13.5/§13.6) grades against §13.4 with M2's focus per spec §14.2.

**State for M3 to assume present:**
- All of M1 + M2: full Makefile chain, both TF applies, carrier deployed and reachable, secret in tenant.
- The portal-stub pod exists; M3 deletes it and replaces with the real portal.
- The carrier serves `/trace` SSE; M3's portal subscribes to it.

**M3 additions:**
- `apps/portal/` Go service with the split-pane UI (§9.2, §10).
- mTLS upgrade for the carrier's `:8443` (spec §9.3 — switch from plain HTTP to MTLSServerConfig).
- Headless-browser smoketest using Playwright (`scripts/smoke-ui.sh`).
- `Makefile`: `portforward`, `up` (renamed from `up-m3` for the public-facing "full demo" target).
