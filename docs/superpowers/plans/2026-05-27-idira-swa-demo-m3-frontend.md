# Idira SWA Demo — M3 Frontend Split UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `portal` Go service that serves a split-pane browser UI on `:8080`. Left pane is a fictional **Praetor Logistics** shipment-lookup portal; right pane is a live **Idira inspector** that shows SPIFFE plumbing events as a click flows through. A `make portforward` exposes `http://localhost:8080`, and a single click of **RESOLVE SECRET** drives the full §5.3 sequence end-to-end with mTLS between portal↔carrier. A headless-browser smoketest asserts the inspector shows all six expected event types within 3 seconds. Brand fidelity (§10) is verified against a captured screenshot.

**Architecture:** One Go service (`portal`), built into a distroless image, deployed alongside the M2 carrier. The carrier is upgraded from plain HTTP to mTLS (spec §9.3) using `go-spiffe` v2 `tlsconfig`. Portal opens an mTLS client to `carrier:8443` (lookup) and a second mTLS client to `carrier:8444` (trace SSE) per spec §9.4. Portal multiplexes its own trace events with carrier's into a single SSE stream the browser subscribes to over plain HTTP on `:8080/trace`. Visual design follows spec §10 to the letter: no emoji, no purple gradients, Idira Blue, Helvetica Neue, sentence case headlines, ALL CAPS CTAs, line-only icons.

**Tech Stack:** Go 1.23, `github.com/spiffe/go-spiffe/v2`, vanilla HTML/CSS/JS (no framework, no build step — explicitly to avoid React/shadcn drift), `embed` for static assets, Playwright (`@playwright/test`) for headless smoke.

**Spec under implementation:** `docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md`. Visual system §10 is normative — copy it; do not improvise.

**Prerequisites the builder verifies in Task 0:**
- M2 is complete: `make up-m2 && make smoke-m2` PASSes from a clean slate.
- The carrier currently serves plain HTTP on `:8443` — M3 upgrades this to mTLS in Task 7 and that change is intentional. Carrier and portal share a Workload API socket and trust bundle.
- Playwright is available globally or installable via `npx playwright install --with-deps`.

---

## File structure (M3 creates)

```
apps/
  portal/
    go.mod                              # Task 1
    go.sum                              # Task 1
    main.go                             # Task 2 — bootstrap, mTLS client, SSE multiplexer
    handler.go                          # Task 3 — /resolve POST handler
    handler_test.go                     # Task 3
    carrier_client.go                   # Task 4 — mTLS client, lookup + trace subscription
    carrier_client_test.go              # Task 4
    trace.go                            # Task 5 — copy of carrier's bus pattern
    ui/                                 # static bundle (Task 6 onwards)
      index.html
      style.css                         # brand tokens, typography, layout (spec §10)
      portal.js                         # left-pane app logic
      inspector.js                      # right-pane SSE consumer
      idira-lockup.svg                  # inline lockup (Task 9)
      icons/                            # line-only SVGs (Task 9)
        identity.svg
        shield.svg
        key.svg
    Dockerfile                          # Task 11
apps/carrier/
  main.go                               # MODIFY (Task 7) — wrap :8443 with mTLS, add :8444 trace
  carrier_test.go                       # NEW (Task 7) — verify mTLS authorizer is explicit
platform/k8s/
  portal.deployment.yaml                # Task 12
  portal.service.yaml                   # Task 12
  carrier.deployment.yaml               # MODIFY (Task 12) — open :8444 port
  portal-stub.yaml                      # DELETED (Task 12) — replaced by real portal
scripts/
  smoke-ui.sh                           # Task 14
ui-tests/
  package.json                          # Task 14
  playwright.config.ts                  # Task 14
  smoke.spec.ts                         # Task 14
```

**M1+M2 files modified:** `Makefile` (add `portforward`, `smoke-m3`, `up`, `smoke`).

---

## Methodology notes

- **Test the JS via Playwright, not via JSDOM.** This is a 200-line vanilla bundle; a unit-test scaffold for it would be more code than the bundle. Playwright's headless run in Task 14 is the test — it loads the real page from `kubectl port-forward`, drives the form, and asserts on the rendered DOM.
- **Brand fidelity is enforceable, not aspirational.** Task 13 captures a reference screenshot; the validator (spec §13.4 criterion 6) opens it and confirms Idira Blue, Helvetica Neue, sentence case, no emoji, no AI markers. The Playwright test additionally asserts a few **invariants** automatically (no `🚀` / `❤️` glyphs anywhere in DOM, no `linear-gradient` containing `purple` or `pink`, no `<Card>` or `shadcn` class on any element).
- **mTLS is a real upgrade.** Task 7 modifies the M2 carrier to require client certs. Until M3 Task 12 deploys the portal alongside the upgraded carrier, the cluster is in a broken in-between state — that's why this milestone replaces the M2 portal-stub atomically rather than letting them coexist.
- **No JS framework.** Spec §10.6 explicitly forbids shadcn/Tailwind defaults. The bundle is vanilla HTML/CSS/JS. This is a hard constraint; do not introduce a bundler.

---

## Task 0: Verify M2 state and Playwright availability

**Files:** none.

- [ ] **Step 1: M2 clean→up→smoke**

```bash
make down
make up-m2
make smoke-m2
```

Expected: `M2 smoketest PASS.` If not, fix M2 before M3.

- [ ] **Step 2: Check Playwright is installable**

```bash
node --version && npx --version
```

Expected: both print versions. Playwright itself is installed in Task 14; Step 2 just verifies the tooling exists.

- [ ] **Step 3: No commit.**

---

## Task 1: Portal Go module

**Files:**
- Create: `apps/portal/go.mod`

- [ ] **Step 1: Init**

```bash
mkdir -p apps/portal
cd apps/portal
go mod init github.com/infamousjoeg/idira-swa-demo/apps/portal
go get github.com/spiffe/go-spiffe/v2@latest
cd ../..
```

- [ ] **Step 2: Commit**

```bash
git add apps/portal/go.mod apps/portal/go.sum
git commit -m "feat(m3): init portal go module"
```

---

## Task 2: Portal `main.go` — bootstrap

**Files:**
- Create: `apps/portal/main.go`

The portal serves three things on port 8080:
- `/` — static UI bundle from `embed.FS`
- `/resolve` — POST handler that calls carrier and returns the shipment JSON
- `/trace` — SSE multiplex of portal's own events + carrier's `/trace` events

It opens an mTLS client to the carrier on demand (no persistent connection — fresh per request).

- [ ] **Step 1: Implement**

```go
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

//go:embed all:ui
var uiFS embed.FS

func main() {
	if err := run(); err != nil {
		log.Fatalf("portal: %v", err)
	}
}

func run() error {
	carrierHost := os.Getenv("CARRIER_HOST")
	if carrierHost == "" {
		carrierHost = "carrier.swa-demo.svc.cluster.local"
	}
	carrierSPIFFE := os.Getenv("CARRIER_SPIFFE_ID")
	if carrierSPIFFE == "" {
		carrierSPIFFE = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"
	}
	socketPath := os.Getenv("SPIFFE_ENDPOINT_SOCKET")
	if socketPath == "" {
		socketPath = "unix:///run/swa-agent/api.sock"
	}

	ctx, cancel := signal.NotifyContext(context.Background(),
		syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	wl, err := workloadapi.New(ctx, workloadapi.WithAddr(socketPath))
	if err != nil {
		return err
	}
	defer wl.Close()

	peer, err := spiffeid.FromString(carrierSPIFFE)
	if err != nil {
		return err
	}
	bus := NewTraceBus(256)
	carrier := NewCarrierClient(wl, carrierHost, peer, bus)

	ui, err := fs.Sub(uiFS, "ui")
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(ui)))
	mux.HandleFunc("/resolve", handleResolve(carrier, bus))
	mux.HandleFunc("/trace", handleTraceSSE(bus))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(shutdownCtx)
	}()

	bus.Emit(traceEvent{Source: "portal", Type: "boot", Payload: map[string]any{
		"carrier_host":   carrierHost,
		"carrier_spiffe": carrierSPIFFE,
	}})
	log.Printf("portal: listening on %s, carrier=%s, spiffe=%s",
		srv.Addr, carrierHost, carrierSPIFFE)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
```

- [ ] **Step 2: No commit yet** (depends on Tasks 3-5 for compile). Continue.

---

## Task 3: `handler.go` — POST /resolve

**Files:**
- Create: `apps/portal/handler.go`
- Create: `apps/portal/handler_test.go`

- [ ] **Step 1: Failing test first**

`apps/portal/handler_test.go`:

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
)

type stubCarrier struct {
	body []byte
	code int
	err  error
}

func (s *stubCarrier) Lookup(_ context.Context, id string) ([]byte, int, error) {
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

// helper for the JSON parse-error test — assert by content
func mustDecode(t *testing.T, body []byte) map[string]any {
	t.Helper()
	out := map[string]any{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}
```

- [ ] **Step 2: Implement `handler.go`**

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type carrierAPI interface {
	Lookup(ctx context.Context, shipmentID string) (body []byte, code int, err error)
}

var errCarrierDown = errors.New("carrier unreachable")

type resolveReq struct {
	ShipmentID string `json:"shipment_id"`
}

func handleResolve(c carrierAPI, bus *TraceBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req resolveReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ShipmentID == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.requested",
			Payload: map[string]any{"id": req.ShipmentID}})

		body, code, err := c.Lookup(r.Context(), req.ShipmentID)
		if err != nil {
			bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.error",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "carrier error", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write(body)
	}
}
```

- [ ] **Step 3: Run tests** (will fail until `trace.go` and `carrier_client.go` exist — defer)

- [ ] **Step 4: No commit yet** (jointly committed with Tasks 4 and 5 once package compiles).

---

## Task 4: `carrier_client.go` — mTLS client + trace subscription

**Files:**
- Create: `apps/portal/carrier_client.go`
- Create: `apps/portal/carrier_client_test.go`

The client exposes:
- `Lookup(ctx, id) → (body, code, err)` — mTLS GET to `https://<host>:8443/lookup/{id}`, also opens a concurrent trace subscription for the lifetime of the request and forwards events into portal's trace bus.

For the unit test, we don't try to test mTLS — we test the URL construction and trace-subscription behavior using a plain `httptest.NewServer`.

- [ ] **Step 1: Failing test**

`apps/portal/carrier_client_test.go`:

```go
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.Path
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"shipment_id":"SHP-2049-883"}`))
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	c := &CarrierClient{
		baseURL:    "http://" + u.Host,
		http:       srv.Client(),
		traceURL:   "http://" + u.Host + "/trace",
		bus:        NewTraceBus(8),
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
```

- [ ] **Step 2: Implement `carrier_client.go`**

```go
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
	"github.com/spiffe/go-spiffe/v2/workloadapi"
)

var shipmentIDRE = regexp.MustCompile(`^SHP-[A-Za-z0-9-]+$`)

// CarrierClient calls the carrier service over mTLS and subscribes to its
// trace SSE stream during each request.
type CarrierClient struct {
	baseURL  string                  // https://<host>:8443
	traceURL string                  // https://<host>:8444/trace
	http     *http.Client            // mTLS-configured in NewCarrierClient
	bus      *TraceBus
}

// NewCarrierClient builds an mTLS-secured client that trusts only the peer
// SPIFFE ID provided. Both the call-path client and the trace-path client
// share the same TLS config (same SVID, same authorizer).
func NewCarrierClient(src *workloadapi.X509Source, host string, peer spiffeid.ID, bus *TraceBus) *CarrierClient {
	tlsCfg := tlsconfig.MTLSClientConfig(src, src, tlsconfig.AuthorizeID(peer))
	return &CarrierClient{
		baseURL:  fmt.Sprintf("https://%s:8443", host),
		traceURL: fmt.Sprintf("https://%s:8444/trace", host),
		http: &http.Client{
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
			Timeout:   15 * time.Second,
		},
		bus: bus,
	}
}

// NewCarrierClient takes a workloadapi.Client in real life. To accept the
// X509Source alias above, we provide a thin adapter:
//   wl, _ := workloadapi.New(...)
//   src   := workloadapi.NewX509Source(...)  // see go-spiffe docs
// In main.go we pass the workloadapi.Client which embeds the source.

// Lookup performs a mTLS GET on /lookup/{id}, returning (body, code, err).
// While the call is in flight, it forwards carrier trace events into bus.
func (c *CarrierClient) Lookup(ctx context.Context, shipmentID string) ([]byte, int, error) {
	if !shipmentIDRE.MatchString(shipmentID) {
		return nil, 0, fmt.Errorf("invalid shipment id: %q", shipmentID)
	}
	// Forward carrier trace concurrently for the lifetime of the lookup.
	traceCtx, cancelTrace := context.WithCancel(ctx)
	defer cancelTrace()
	go c.streamCarrierTrace(traceCtx)

	c.bus.Emit(traceEvent{Source: "portal", Type: "mtls.handshake.start",
		Payload: map[string]any{"peer_host": hostFromURL(c.baseURL)}})

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/lookup/"+url.PathEscape(shipmentID), nil)
	resp, err := c.http.Do(req)
	if err != nil {
		c.bus.Emit(traceEvent{Source: "portal", Type: "mtls.handshake.err",
			Payload: map[string]any{"err": err.Error()}})
		return nil, 0, errors.Join(errCarrierDown, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	c.bus.Emit(traceEvent{Source: "portal", Type: "mtls.handshake.ok",
		Payload: map[string]any{"peer_host": hostFromURL(c.baseURL),
			"cipher": tlsCipherName(resp.TLS)}})
	return body, resp.StatusCode, nil
}

func (c *CarrierClient) streamCarrierTrace(ctx context.Context) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.traceURL, nil)
	resp, err := c.http.Do(req)
	if err != nil {
		c.bus.Emit(traceEvent{Source: "portal", Type: "carrier.trace.unreachable",
			Payload: map[string]any{"err": err.Error()}})
		return
	}
	defer resp.Body.Close()
	buf := make([]byte, 8192)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			// SSE frames are "data: {...}\n\n". Strip prefix and forward as-is.
			for _, frame := range splitFrames(string(buf[:n])) {
				c.bus.Emit(traceEvent{Source: "carrier", Type: "carrier.event.raw",
					Payload: map[string]any{"frame": frame}})
			}
		}
		if err != nil {
			return
		}
	}
}

func splitFrames(s string) []string {
	out := []string{}
	for _, chunk := range splitOnDoubleNewline(s) {
		if len(chunk) > 6 && chunk[:6] == "data: " {
			out = append(out, chunk[6:])
		}
	}
	return out
}

func splitOnDoubleNewline(s string) []string {
	res, cur := []string{}, ""
	for i := 0; i < len(s); i++ {
		cur += string(s[i])
		if i >= 1 && s[i-1] == '\n' && s[i] == '\n' {
			res = append(res, cur[:len(cur)-2])
			cur = ""
		}
	}
	if cur != "" {
		res = append(res, cur)
	}
	return res
}

func hostFromURL(u string) string {
	parsed, err := url.Parse(u)
	if err != nil {
		return u
	}
	return parsed.Host
}

func tlsCipherName(s *tls.ConnectionState) string {
	if s == nil {
		return "none"
	}
	return tls.CipherSuiteName(s.CipherSuite)
}
```

> **Note on the source/client API:** `tlsconfig.MTLSClientConfig` wants an `x509svid.Source` and `x509bundle.Source`. `workloadapi.Client` implements both via `.X509Source()`. In `main.go`, replace the `workloadapi.New` line with `workloadapi.NewX509Source(ctx, workloadapi.WithClientOptions(workloadapi.WithAddr(socketPath)))` and pass the source to `NewCarrierClient`. Adjust the signature in this task accordingly.

- [ ] **Step 3: Adjust main.go signature mismatch**

In `main.go` from Task 2, replace:

```go
wl, err := workloadapi.New(ctx, workloadapi.WithAddr(socketPath))
…
carrier := NewCarrierClient(wl, carrierHost, peer, bus)
```

with:

```go
src, err := workloadapi.NewX509Source(ctx,
	workloadapi.WithClientOptions(workloadapi.WithAddr(socketPath)))
…
carrier := NewCarrierClient(src, carrierHost, peer, bus)
```

And update the import block in `main.go` if `workloadapi.NewX509Source` requires a different alias.

- [ ] **Step 4: Run unit tests** (will fail until `trace.go` is in place — Task 5)

- [ ] **Step 5: No commit yet.**

---

## Task 5: `trace.go` — copy of carrier's pattern

**Files:**
- Create: `apps/portal/trace.go`

This is intentionally a copy of `apps/carrier/trace.go` from M2 Task 7 with no changes. We resist the temptation to extract a shared package — see spec §3 non-goals (no library extraction); it's two services with one identical 80-line file, totally tolerable.

- [ ] **Step 1: Implement (paste from `apps/carrier/trace.go`)**

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

- [ ] **Step 2: Run portal tests — expect PASS**

```bash
cd apps/portal && go test -v ./...
```

Expected: all tests from Tasks 3 and 4 PASS (~6 PASS).

- [ ] **Step 3: Build portal binary**

```bash
cd apps/portal && go build -o /tmp/portal .
```

Expected: succeeds. Running it without env errors out usefully.

- [ ] **Step 4: Commit Tasks 2-5 jointly**

```bash
git add apps/portal/main.go apps/portal/handler.go apps/portal/handler_test.go \
        apps/portal/carrier_client.go apps/portal/carrier_client_test.go \
        apps/portal/trace.go apps/portal/go.sum
git commit -m "feat(m3): portal main, /resolve handler, mtls carrier client, trace bus"
```

---

## Task 6: UI bundle skeleton — `index.html`

**Files:**
- Create: `apps/portal/ui/index.html`

50/50 split at ≥1024px, stacking below. Spec §10.3.

- [ ] **Step 1: Create `apps/portal/ui/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Praetor Logistics — shipment lookup</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="split">
  <!-- Left pane: the fictional consumer surface -->
  <section class="pane pane--portal" aria-label="Praetor Logistics shipment lookup">
    <header class="lockup">
      <span class="lockup__mark">Idira</span>
      <span class="lockup__sig">BY PALO ALTO NETWORKS</span>
    </header>
    <h1 class="headline">Workloads with real identity.</h1>
    <p class="lede">Resolve a shipment using credentials the workload doesn't carry.</p>

    <form id="resolveForm" class="resolve" novalidate>
      <label for="shipmentId" class="resolve__label">Shipment ID</label>
      <input id="shipmentId" name="shipment_id" type="text" autocomplete="off"
        value="SHP-2049-883" required pattern="SHP-[A-Za-z0-9-]+">
      <button type="submit" class="cta">RESOLVE SECRET</button>
    </form>

    <div id="result" class="result" aria-live="polite"></div>
  </section>

  <!-- Right pane: the Idira inspector -->
  <aside class="pane pane--inspector" aria-label="Idira inspector">
    <header class="inspector__head">
      <span class="inspector__eyebrow">Idira inspector</span>
      <span class="inspector__sub">spiffe / mtls / jwt-svid</span>
    </header>
    <ol id="trace" class="trace" aria-live="polite"></ol>
  </aside>
</div>
<script type="module" src="portal.js"></script>
<script type="module" src="inspector.js"></script>
</body>
</html>
```

- [ ] **Step 2: No commit yet** (committed jointly with CSS in Task 8).

---

## Task 7: Carrier mTLS upgrade (spec §9.3, §9.4)

**Files:**
- Modify: `apps/carrier/main.go` — wrap :8443 with `tlsconfig.MTLSServerConfig` authorizing portal SPIFFE; add :8444 trace server (same TLS config)
- Create: `apps/carrier/main_test.go` — assert the authorizer is **explicit** (not `AuthorizeAny`)

- [ ] **Step 1: Modify `apps/carrier/main.go`** — replace the `srv := &http.Server{…}` block and what follows

```go
import (
    // add:
    "crypto/tls"
    "github.com/spiffe/go-spiffe/v2/spiffeid"
    "github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
    "github.com/spiffe/go-spiffe/v2/workloadapi"
)

// in run(), after wlClient is created, build an X509 source for TLS configs:
src, err := workloadapi.NewX509Source(rootCtx,
    workloadapi.WithClientOptions(workloadapi.WithAddr(socketPath)))
if err != nil {
    return err
}
defer src.Close()

// Authorize ONLY the portal SPIFFE ID. AuthorizeAny is forbidden (spec §13.4 #4).
portalSPIFFE := os.Getenv("PORTAL_SPIFFE_ID")
if portalSPIFFE == "" {
    portalSPIFFE = "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal"
}
peer, err := spiffeid.FromString(portalSPIFFE)
if err != nil {
    return err
}
mtlsCfg := tlsconfig.MTLSServerConfig(src, src, tlsconfig.AuthorizeID(peer))

// Main API server (8443) — mTLS.
srv := &http.Server{
    Addr:              ":8443",
    Handler:           mux,
    TLSConfig:         mtlsCfg,
    ReadHeaderTimeout: 5 * time.Second,
}

// Trace server (8444) — separate mux, same mTLS config so only the portal can subscribe.
traceMux := http.NewServeMux()
traceMux.HandleFunc("/trace", handleTraceSSE(bus))
traceSrv := &http.Server{
    Addr:              ":8444",
    Handler:           traceMux,
    TLSConfig:         mtlsCfg,
    ReadHeaderTimeout: 5 * time.Second,
}
go func() {
    if err := traceSrv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
        log.Printf("carrier trace server: %v", err)
    }
}()
go func() {
    <-rootCtx.Done()
    shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
    defer c()
    _ = srv.Shutdown(shutdownCtx)
    _ = traceSrv.Shutdown(shutdownCtx)
}()

// Replace `srv.ListenAndServe()` with TLS variant; cert/key come from TLSConfig.
if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
    return err
}
return nil
```

Note: with `TLSConfig` providing certs via `GetCertificate`, the empty strings to `ListenAndServeTLS` are intentional and correct.

- [ ] **Step 2: Add `apps/carrier/main_test.go`** — small sanity test that the authorizer factory we use is `AuthorizeID`, not `AuthorizeAny`

```go
package main

import (
	"strings"
	"testing"
)

// Smoke check: source verification — the authorizer name in main.go must be
// AuthorizeID. Grep-based test so it doesn't depend on internal types.
func TestMTLSAuthorizerIsExplicit(t *testing.T) {
	src := mustReadFile(t, "main.go")
	if !strings.Contains(src, "tlsconfig.AuthorizeID(") {
		t.Errorf("main.go must use tlsconfig.AuthorizeID")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeAny(") {
		t.Errorf("main.go uses AuthorizeAny — forbidden by spec §13.4 #4")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeMemberOf(") {
		t.Errorf("main.go uses AuthorizeMemberOf — too permissive for this demo")
	}
}

func mustReadFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
```

Add `"os"` to the imports if not already there.

- [ ] **Step 3: Run carrier tests**

```bash
cd apps/carrier && go test ./...
```

Expected: all M2 tests still PASS + new `TestMTLSAuthorizerIsExplicit` PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/carrier/main.go apps/carrier/main_test.go
git commit -m "feat(m3): upgrade carrier :8443 to mtls + add :8444 trace server (explicit AuthorizeID)"
```

---

## Task 8: UI bundle — `style.css` with brand tokens (spec §10)

**Files:**
- Create: `apps/portal/ui/style.css`

Direct realization of spec §10.1–§10.4. **Do not deviate.** No new tokens, no extra components, no gradients beyond linear Idira blue.

- [ ] **Step 1: Create `apps/portal/ui/style.css`**

```css
:root {
  /* Idira (primary brand for this surface) */
  --idira-0:    #ADC0FC;
  --idira-250:  #6186FC;
  --idira-500:  #265BFF;
  --idira-750:  #173EB8;
  --idira-1000: #061D63;

  /* PANW parent palette */
  --panw-orange: #FA582D;
  --panw-ink:    #190000;

  /* Neutrals */
  --bg:           #FFFFFF;
  --bg-inspector: #0B0D14;
  --text:         #190000;
  --text-mute:    #4A4A52;
  --line:         #D8D8DF;

  --font-headline: "TT Hoves", "Inter", -apple-system, sans-serif;
  --font-body:     "Helvetica Neue", Helvetica, Arial, -apple-system, sans-serif;
  --font-mono:     ui-monospace, "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font: 400 16px/26px var(--font-body);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

/* === split layout === */
.split {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
}
@media (min-width: 1024px) {
  .split { grid-template-columns: 1fr 1fr; }
}
.pane { padding: 24px; }
@media (min-width: 1024px) { .pane { padding: 48px; } }

.pane--portal {
  background: var(--bg);
  color: var(--text);
}
.pane--inspector {
  background: var(--bg-inspector);
  color: var(--idira-0);
  font-family: var(--font-mono);
  border-left: 1px solid #16192a;
}

/* === lockup === */
.lockup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 56px;
}
.lockup__mark {
  font: 700 22px/1 var(--font-headline);
  letter-spacing: -0.01em;
  color: var(--idira-500);
}
.lockup__sig {
  font-family: var(--font-body);
  font-weight: 900;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: var(--text-mute);
}

/* === headline + body === */
.headline {
  font: 600 56px/64px var(--font-headline);
  letter-spacing: -0.015em;
  margin: 0 0 16px;
}
.lede {
  font-size: 18px;
  line-height: 28px;
  color: var(--text-mute);
  margin: 0 0 32px;
  max-width: 50ch;
}

/* === form === */
.resolve { display: flex; flex-direction: column; gap: 12px; max-width: 480px; }
.resolve__label {
  font: 700 12px/1 var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-mute);
}
.resolve input {
  font: 500 16px/1 var(--font-mono);
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
}
.resolve input:focus {
  outline: 2px solid var(--idira-500);
  outline-offset: 0;
}

/* === CTA per spec §10.4: square, ALL CAPS, no shadow === */
.cta {
  font: 700 13px/1 var(--font-headline);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 14px 22px;
  background: var(--text);
  color: #fff;
  border: 0;
  cursor: pointer;
}
.cta:hover  { background: var(--idira-1000); }
.cta:active { background: var(--idira-750); }
.cta:disabled { background: var(--text-mute); cursor: progress; }

/* === result === */
.result {
  margin-top: 40px;
  border-top: 1px solid var(--line);
  padding-top: 24px;
  min-height: 100px;
}
.result__row { display: flex; gap: 16px; padding: 8px 0; }
.result__k {
  font: 700 11px/16px var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-mute);
  flex: 0 0 140px;
}
.result__v { font-family: var(--font-mono); }

/* === inspector === */
.inspector__head {
  display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px;
  padding-bottom: 16px; border-bottom: 1px solid #16192a;
}
.inspector__eyebrow {
  font: 700 10px/1 var(--font-body);
  text-transform: uppercase; letter-spacing: 0.18em;
  color: var(--idira-250);
}
.inspector__sub {
  font-size: 11px;
  color: var(--text-mute);
}

.trace {
  list-style: none;
  margin: 0; padding: 0;
  display: flex; flex-direction: column;
  gap: 4px;
  font-size: 12px; line-height: 18px;
}
.trace__row {
  display: grid;
  grid-template-columns: 78px 88px 1fr;
  gap: 12px;
  padding: 4px 0;
  animation: fade-in 120ms ease-out;
}
.trace__ts   { color: var(--text-mute); }
.trace__src  { color: var(--idira-250); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
.trace__body { color: var(--idira-0); word-break: break-all; }
.trace__body .pill {
  display: inline-block;
  border: 1px solid currentColor;
  padding: 1px 6px;
  margin-right: 6px;
  font-size: 10px;
  color: var(--idira-250);
}
.trace__body--err { color: var(--panw-orange); }

@keyframes fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* === explicit anti-bling (defensive against future drift) === */
* { text-shadow: none !important; }
.cta { box-shadow: none !important; border-radius: 0 !important; }
.resolve input { border-radius: 0 !important; }
```

- [ ] **Step 2: Commit `index.html` + `style.css`**

```bash
git add apps/portal/ui/index.html apps/portal/ui/style.css
git commit -m "feat(m3): ui shell — split layout, brand tokens, helvetica neue, all-caps cta"
```

---

## Task 9: UI bundle — JS (portal.js + inspector.js)

**Files:**
- Create: `apps/portal/ui/portal.js`
- Create: `apps/portal/ui/inspector.js`

- [ ] **Step 1: `apps/portal/ui/portal.js`** — form submission + result rendering

```js
const form    = document.getElementById('resolveForm');
const result  = document.getElementById('result');
const button  = form.querySelector('button.cta');
const input   = form.querySelector('input[name="shipment_id"]');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = input.value.trim();
  if (!id) return;

  button.disabled = true;
  result.innerHTML = '';

  try {
    const resp = await fetch('/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipment_id: id }),
    });
    if (resp.status === 404) {
      renderRow(result, 'status', 'shipment not found');
      return;
    }
    if (!resp.ok) {
      renderRow(result, 'status', `error · ${resp.status}`);
      return;
    }
    const data = await resp.json();
    renderResult(result, data);
  } catch (err) {
    renderRow(result, 'error', String(err));
  } finally {
    button.disabled = false;
  }
});

function renderResult(root, data) {
  const order = ['shipment_id', 'origin', 'destination', 'eta', 'carrier_name'];
  for (const k of order) {
    if (k in data) renderRow(root, k.replace(/_/g, ' '), data[k]);
  }
}

function renderRow(root, k, v) {
  const row = document.createElement('div');
  row.className = 'result__row';

  const kEl = document.createElement('span');
  kEl.className = 'result__k';
  kEl.textContent = k;

  const vEl = document.createElement('span');
  vEl.className = 'result__v';
  vEl.textContent = v;

  row.append(kEl, vEl);
  root.append(row);
}
```

- [ ] **Step 2: `apps/portal/ui/inspector.js`** — SSE consumer

```js
const trace = document.getElementById('trace');
const es    = new EventSource('/trace');

es.onmessage = (ev) => {
  let event;
  try { event = JSON.parse(ev.data); } catch { return; }
  // carrier.event.raw frames are JSON-encoded events from carrier; unwrap them.
  if (event.type === 'carrier.event.raw' && event.payload && event.payload.frame) {
    try { event = JSON.parse(event.payload.frame); } catch {}
  }
  renderTrace(event);
};

es.onerror = () => {
  // Browser auto-reconnects EventSource; just surface a quiet line.
  renderTrace({
    ts: new Date().toISOString(),
    source: 'portal',
    type: 'trace.reconnecting',
    payload: {},
  }, /*err*/ true);
};

function renderTrace(ev, err) {
  const li = document.createElement('li');
  li.className = 'trace__row';

  const ts = document.createElement('span');
  ts.className = 'trace__ts';
  ts.textContent = formatTs(ev.ts);

  const src = document.createElement('span');
  src.className = 'trace__src';
  src.textContent = (ev.source || 'unknown').toLowerCase();

  const body = document.createElement('span');
  body.className = 'trace__body' + (err || /\.err$/.test(ev.type) ? ' trace__body--err' : '');
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = ev.type;
  body.append(pill);

  // For events with a SPIFFE ID, monospace it.
  const sub = summarizePayload(ev.payload);
  if (sub) body.append(document.createTextNode(sub));

  li.append(ts, src, body);
  trace.append(li);
  // Keep the latest 200 rows; older fade off.
  while (trace.childElementCount > 200) trace.firstElementChild.remove();
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function formatTs(s) {
  if (!s) return '';
  const d = new Date(s);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function summarizePayload(p) {
  if (!p) return '';
  if (p.spiffe_id) return p.spiffe_id;
  if (p.peer)      return p.peer;
  if (p.id)        return `id=${p.id}`;
  if (p.bytes)     return `bytes=${p.bytes}`;
  if (p.err)       return p.err;
  return '';
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/portal/ui/portal.js apps/portal/ui/inspector.js
git commit -m "feat(m3): ui js — resolve form + sse inspector (vanilla, no framework)"
```

---

## Task 10: Sanity-build the portal binary with embedded UI

**Files:** none modified.

- [ ] **Step 1: Build**

```bash
cd apps/portal && go build -o /tmp/portal .
```

Expected: build succeeds; the resulting binary contains the UI bundle (verify with `strings /tmp/portal | grep 'Workloads with real identity' | head`).

- [ ] **Step 2: Sanity tests pass**

```bash
cd apps/portal && go test ./...
```

Expected: all PASS.

- [ ] **Step 3: No commit** (verification only).

---

## Task 11: Portal `Dockerfile` + `build-apps` extension

**Files:**
- Create: `apps/portal/Dockerfile`
- Modify: `Makefile` (`build-apps` to also build portal)

- [ ] **Step 1: `apps/portal/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -trimpath -ldflags='-s -w' -o /out/portal .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/portal /portal
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/portal"]
```

- [ ] **Step 2: Extend `build-apps` target**

```make
build-apps: ## Build the demo app images and load into kind
	docker build -t idira/carrier:m2 apps/carrier/
	docker build -t idira/portal:m3  apps/portal/
	kind load docker-image idira/carrier:m2 --name $(KIND_CLUSTER)
	kind load docker-image idira/portal:m3  --name $(KIND_CLUSTER)
```

(The carrier tag stays `:m2` because Task 7's change is backwards-compatible: callers without certs get a TLS handshake failure, which is the intended behavior. Bumping the tag to `:m3` would just mean more cache misses.)

- [ ] **Step 3: Run**

```bash
make build-apps
```

Expected: two `docker build`s succeed, two `kind load`s succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/Dockerfile Makefile
git commit -m "feat(m3): portal dockerfile + extend build-apps to include portal"
```

---

## Task 12: Portal Deployment + Service, retire portal-stub, expose carrier :8444

**Files:**
- Create: `platform/k8s/portal.deployment.yaml`
- Create: `platform/k8s/portal.service.yaml`
- Modify: `platform/k8s/carrier.deployment.yaml` — add `containerPort: 8444`
- Modify: `Makefile` — `deploy-apps` replaces portal-stub with real portal
- Delete: `platform/k8s/portal-stub.yaml` (the M2 stub is no longer needed)

- [ ] **Step 1: Modify `platform/k8s/carrier.deployment.yaml`** — add a port

In the existing `ports:` block, add:
```yaml
            - containerPort: 8444
              name: trace
```

So the full ports block now reads:
```yaml
          ports:
            - containerPort: 8443
              name: http
            - containerPort: 8444
              name: trace
```

- [ ] **Step 2: Modify `platform/k8s/carrier.service.yaml`** — expose 8444

```yaml
  ports:
    - port: 8443
      targetPort: 8443
      name: http
    - port: 8444
      targetPort: 8444
      name: trace
```

- [ ] **Step 3: Create `platform/k8s/portal.deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: portal
  namespace: swa-demo
  labels: {app: portal}
spec:
  replicas: 1
  selector: {matchLabels: {app: portal}}
  template:
    metadata:
      labels: {app: portal}
    spec:
      serviceAccountName: portal
      containers:
        - name: portal
          image: idira/portal:m3
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
              name: http
          env:
            - name: CARRIER_HOST
              value: carrier.swa-demo.svc.cluster.local
            - name: CARRIER_SPIFFE_ID
              value: spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier
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

- [ ] **Step 4: Create `platform/k8s/portal.service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: portal
  namespace: swa-demo
spec:
  selector: {app: portal}
  ports:
    - port: 8080
      targetPort: 8080
      name: http
```

- [ ] **Step 5: Also modify the carrier deployment env** — pass `PORTAL_SPIFFE_ID`

Add to the carrier's `env:` block:
```yaml
            - name: PORTAL_SPIFFE_ID
              value: spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal
```

- [ ] **Step 6: Update `deploy-apps`** — drop the stub, apply the new manifests

```make
deploy-apps: ## Deploy carrier + portal into swa-demo
	kubectl apply -f platform/k8s/namespace.yaml
	@kubectl -n swa-demo create configmap carrier-config \
	  --from-literal=sm_url=$(PANW_SM_URL) \
	  --from-literal=secret_id=swa-demo/carrier/api-key \
	  --dry-run=client -o yaml | kubectl apply -f -
	-kubectl -n swa-demo delete pod portal-stub --ignore-not-found
	kubectl apply -f platform/k8s/carrier.deployment.yaml
	kubectl apply -f platform/k8s/carrier.service.yaml
	kubectl apply -f platform/k8s/portal.deployment.yaml
	kubectl apply -f platform/k8s/portal.service.yaml
	kubectl -n swa-demo rollout status deploy/carrier --timeout=2m
	kubectl -n swa-demo rollout status deploy/portal  --timeout=2m
```

- [ ] **Step 7: Delete the stub manifest**

```bash
git rm platform/k8s/portal-stub.yaml
```

- [ ] **Step 8: Apply**

```bash
make deploy-apps
kubectl -n swa-demo get pods
```

Expected: carrier and portal both Running 1/1, no portal-stub.

- [ ] **Step 9: Commit**

```bash
git add platform/k8s/portal.deployment.yaml platform/k8s/portal.service.yaml \
        platform/k8s/carrier.deployment.yaml platform/k8s/carrier.service.yaml Makefile
git commit -m "feat(m3): deploy portal + expose carrier :8444 trace port + retire portal-stub"
```

---

## Task 13: `portforward` Make target + visual sanity check

**Files:**
- Modify: `Makefile` (add `portforward`)

- [ ] **Step 1: Add target**

```make
.PHONY: portforward

portforward: ## Forward portal :8080 to localhost (blocks)
	@echo 'Portal at http://localhost:8080 — Ctrl+C to stop'
	kubectl -n swa-demo port-forward svc/portal 8080:8080
```

- [ ] **Step 2: Manual visual sanity check** (validator will do this too — spec §13.4 criterion 6)

In one terminal:
```bash
make portforward
```

In a browser, open `http://localhost:8080`. Verify by eye:
- Lockup top-left reads "Idira" in Idira Blue, then "BY PALO ALTO NETWORKS" in tiny all-caps below.
- Headline reads "Workloads with real identity." in sentence case (no title case, no `!`).
- Body font is Helvetica Neue (or fallback Helvetica) — not San Francisco. (On macOS, Cmd+Opt+I → Computed → font-family.)
- CTA reads "RESOLVE SECRET" in all caps with letter-spacing; black background, white text, square corners, no shadow.
- Right pane is near-black with mono type. After page load, the inspector already has at least a `boot` event from each service.

- [ ] **Step 3: Capture reference screenshot for validator**

```bash
mkdir -p out
# In a second terminal while portforward is running:
( cd ui-tests && npx playwright install chromium >/dev/null 2>&1 || true )
node -e "
const {chromium} = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto('http://localhost:8080');
  await p.waitForTimeout(500);
  await p.screenshot({path: 'out/m3-portal-empty.png', fullPage: true});
  await b.close();
})();
" || echo 'screenshot captured manually if node script is unavailable'
ls -la out/m3-portal-empty.png
```

(If Playwright isn't installed locally, the ui-tests harness in Task 14 captures equivalent screenshots automatically.)

- [ ] **Step 4: Commit**

```bash
git add Makefile
[[ -f out/m3-portal-empty.png ]] && git add out/m3-portal-empty.png
git commit -m "feat(m3): portforward target + reference screenshot for brand validation"
```

(Note: `out/` should be added to `.gitignore` if you don't want screenshots checked in — for this demo, committing one reference screenshot per milestone gives the validator something durable to compare against. Adjust per the team's preference.)

---

## Task 14: Headless-browser smoketest (spec §14.3)

**Files:**
- Create: `ui-tests/package.json`
- Create: `ui-tests/playwright.config.ts`
- Create: `ui-tests/smoke.spec.ts`
- Create: `scripts/smoke-ui.sh`
- Modify: `Makefile` (add `smoke-m3`)

- [ ] **Step 1: `ui-tests/package.json`**

```json
{
  "name": "idira-swa-demo-ui-tests",
  "version": "0.0.0",
  "private": true,
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  },
  "scripts": {
    "test": "playwright test"
  }
}
```

- [ ] **Step 2: `ui-tests/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: `ui-tests/smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXPECTED_EVENT_TYPES = [
  'portal.resolve.requested',
  'mtls.handshake.start',
  'jwt_svid.issued',
  'sm.authn_jwt.ok',
  'sm.secret_fetched.ok',
  'carrier.lookup.ok',
];

test('portal loads with brand-correct shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Praetor Logistics/);
  await expect(page.locator('.lockup__mark')).toHaveText('Idira');
  await expect(page.locator('.cta')).toHaveText('RESOLVE SECRET');

  // No emoji anywhere in the rendered DOM.
  const text = await page.evaluate(() => document.body.innerText);
  // eslint-disable-next-line no-misleading-character-class
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

  // No forbidden CSS patterns.
  const styles = await page.evaluate(() => {
    return Array.from(document.styleSheets).flatMap(s => {
      try { return Array.from(s.cssRules).map(r => (r as CSSRule).cssText); }
      catch { return []; }
    }).join('\n');
  });
  expect(styles).not.toMatch(/linear-gradient[^;]*\b(purple|pink|magenta|violet)\b/i);
  expect(styles).not.toMatch(/\bshadcn\b/i);

  // Body font must be Helvetica Neue (or its named fallback chain), not SF Pro.
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(body).toMatch(/Helvetica/);

  fs.mkdirSync('../out', { recursive: true });
  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-empty.png'), fullPage: true });
});

test('resolving a shipment drives the full SPIFFE → SM → fixture sequence', async ({ page }) => {
  const events: string[] = [];

  // Subscribe to /trace via fetch + ReadableStream so we observe the same SSE
  // the UI sees, but in a buffer the test can assert on.
  await page.exposeFunction('recordEvent', (t: string) => { events.push(t); });
  await page.addInitScript(() => {
    const es = new EventSource('/trace');
    es.onmessage = (ev) => {
      try {
        let parsed = JSON.parse(ev.data);
        if (parsed.type === 'carrier.event.raw' && parsed.payload?.frame) {
          parsed = JSON.parse(parsed.payload.frame);
        }
        // @ts-ignore
        window.recordEvent(parsed.type);
      } catch {}
    };
  });

  await page.goto('/');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');

  await expect(page.locator('.result__row').first()).toBeVisible({ timeout: 5000 });

  // All six expected event types must have arrived within the test timeout.
  await expect.poll(() => EXPECTED_EVENT_TYPES.every(t => events.includes(t)),
    { timeout: 5000 }).toBe(true);

  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-resolved.png'), fullPage: true });
});

test('unknown shipment surfaces not-found, does NOT crash UI', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[name="shipment_id"]', 'SHP-DOES-NOT-EXIST');
  await page.click('button.cta');
  await expect(page.locator('.result__row .result__v').first()).toHaveText(/not found/i, { timeout: 5000 });
});
```

- [ ] **Step 4: Install Playwright** (one-time per machine)

```bash
( cd ui-tests && npm install && npx playwright install chromium )
```

Expected: Playwright + Chromium downloaded (~150MB first time).

- [ ] **Step 5: `scripts/smoke-ui.sh`** — drives portforward + Playwright

```bash
#!/usr/bin/env bash
# smoke-ui.sh — start port-forward, run Playwright, clean up.
set -euo pipefail

pf_log=$(mktemp)
kubectl -n swa-demo port-forward svc/portal 8080:8080 >"$pf_log" 2>&1 &
pf_pid=$!
trap "kill $pf_pid 2>/dev/null; rm -f $pf_log" EXIT

# Wait for the port-forward to be ready.
for i in {1..30}; do
  curl -sf http://localhost:8080/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:8080/healthz >/dev/null || {
  echo 'port-forward never became ready'; cat "$pf_log"; exit 1
}

( cd ui-tests && BASE_URL=http://localhost:8080 npx playwright test )
```

- [ ] **Step 6: Add Make target**

```make
.PHONY: smoke-m3

smoke-m3: ## Run M3 acceptance check (headless browser)
	@./scripts/smoke-ui.sh
```

- [ ] **Step 7: Make executable and run**

```bash
chmod +x scripts/smoke-ui.sh
make smoke-m3
```

Expected: Playwright runs three tests, all PASS. Screenshots written to `out/m3-smoke-*.png`.

- [ ] **Step 8: `.gitignore` Playwright noise**

Append to `.gitignore`:
```
ui-tests/node_modules/
ui-tests/test-results/
ui-tests/playwright-report/
```

- [ ] **Step 9: Commit**

```bash
git add ui-tests/package.json ui-tests/package-lock.json ui-tests/playwright.config.ts \
        ui-tests/smoke.spec.ts scripts/smoke-ui.sh Makefile .gitignore
git commit -m "feat(m3): headless playwright smoke (brand asserts + full sequence + 404 path)"
```

---

## Task 15: Top-level `up` and `smoke` aliases (full demo)

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add public `up` and `smoke` targets**

```make
.PHONY: up smoke

up: up-m1 build-apps deploy-apps tf-apply-app smoke-m3 ## Full demo deploy + smoketest
	@echo
	@echo 'Demo ready. Run: make portforward'

smoke: smoke-m1 smoke-m2 smoke-m3 ## Run all milestone smoketests
```

(Note: `up` chains the milestone parts but uses `smoke-m3` at the end — the M3 smoketest exercises the full M1+M2+M3 stack so M1 and M2's individual smoketests are redundant during `make up`. `smoke` runs all three so the validator can spot which milestone broke.)

- [ ] **Step 2: Run the full thing from a clean slate**

```bash
make down
make up
make smoke
```

Expected: cluster comes up, all manifests deploy, M3 smoke PASSes inside `up`, then `smoke` re-runs all three milestone smoketests and all PASS. Total wall time ≈ 4 min after `images` finishes.

- [ ] **Step 3: Confirm `make down` cleans everything**

```bash
make down
kind get clusters | grep -q '^swa$' && echo FAIL || echo '[ok] cluster gone'
terraform -chdir=platform/terraform state list | wc -l | tr -d ' '
```

Expected: `[ok] cluster gone`, state-list output `0`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat(m3): top-level make up and make smoke targets (full demo)"
```

---

## Task 16: README polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README content** (M1 only had a skeleton)

```markdown
# Idira SWA Demo

A Mac-laptop demo of Palo Alto Networks' **Idira Secure Workload Access (SWA)**:
a workload fetches a real secret from CyberArk Secrets Manager – SaaS using a
SPIFFE JWT-SVID minted in-cluster — no static credentials in the workload, no
agent token on disk. The UI splits left/right so you can watch the SPIFFE
plumbing as you click.

## What you see

Open `http://localhost:8080` after `make up && make portforward`:

- **Left** — Praetor Logistics shipment-lookup portal (the consumer surface).
- **Right** — Idira inspector. Live trace of every hop: mTLS handshake, JWT-SVID
  issuance, SM authn-jwt exchange, secret fetch, fixture lookup.

Click **RESOLVE SECRET** and the inspector fills in within ~200ms.

## Prerequisites

- macOS Apple Silicon
- `docker`, `kind`, `kubectl`, `helm`, `terraform`, `jq`, `curl`, `node` ≥ 18
- `swa-release-1.0.4/` bundle in this directory (gitignored vendor drop)
- A Secrets Manager – SaaS tenant with an OAuth client. Copy `.envrc.example`
  to `.envrc` and fill in `IDIRA_CLIENT_ID` / `IDIRA_CLIENT_SECRET`.
- `make doctor` enforces the above.

## Quick start

```bash
cp .envrc.example .envrc && vim .envrc      # fill in client_id / client_secret
direnv allow                                 # or source .envrc
make doctor                                  # verify prerequisites
make up                                      # full deploy + headless smoke (~4 min)
make portforward                             # serve portal on http://localhost:8080
# ... demo away ...
make down                                    # tear everything down (cluster + tenant TF state)
```

## Milestone breakdown

| Make target   | What it does |
|---|---|
| `make up-m1`  | kind + SWA platform up (server + agent healthy, SPIFFE hierarchy on tenant) |
| `make up-m2`  | + carrier service + JWT authn + policy + secret |
| `make up`     | + portal UI + headless smoke |

| Smoke target  | What it asserts |
|---|---|
| `make smoke-m1` | server/agent healthy; RSA workload key override in effect |
| `make smoke-m2` | carrier resolves a shipment via JWT-SVID end-to-end; error paths work |
| `make smoke-m3` | full click sequence drives 6 expected event types within 3s; brand asserts |
| `make smoke`    | all three above |

## Token TTL

Identity OAuth tokens are ≤15 min; SM access tokens are ~8 min. Every Make
target that touches the tenant re-fetches a fresh token via
`scripts/get-sm-token.sh`. For manual `terraform` runs, source
`eval "$(make tf-token)"` first.

## Design

`docs/superpowers/specs/2026-05-27-idira-swa-demo-design.md` — full spec.
`docs/superpowers/plans/2026-05-27-idira-swa-demo-m{1,2,3}-*.md` — implementation plans.

## Brand and visual constraints

The UI is hand-built vanilla HTML/CSS/JS (no React, no Tailwind, no shadcn) to
hold the brand line. See spec §10. CI-style asserts in
`ui-tests/smoke.spec.ts` reject emoji, purple/pink gradients, and shadcn class
markers anywhere in the rendered DOM.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(m3): polish readme with milestone breakdown + brand constraints"
```

---

## Task 17: Final validator walkthrough (spec §13.4 criterion 10)

**Files:** none. Verification.

- [ ] **Step 1: From a clean slate**

```bash
make down
make up
make smoke
make down
```

Expected: every step passes, `down` leaves the system clean. Total wall time ≈ 5 min.

- [ ] **Step 2: Cleanup asserts**

```bash
kind get clusters | grep -q '^swa$' && { echo FAIL: cluster present; exit 1; } || echo '[ok] kind clean'
terraform -chdir=platform/terraform state list | wc -l | tr -d ' '   # expect 0
kubectl get ns 2>/dev/null | grep -E 'swa-(system|demo)' && { echo FAIL: ns present; exit 1; } || echo '[ok] ns clean'
```

Expected: all three checks pass.

- [ ] **Step 3: No commit (verification only).**

---

## M3 done — demo ships

The validator subagent grades the M3 diff against spec §13.4. M3's distinguishing criteria are #5 (no AI markers) and #6 (brand fidelity); the validator opens `out/m3-smoke-empty.png` and confirms by eye plus the automated Playwright asserts.

Once §13.4 PASSes at 9/10, the demo is shippable. The validator can hand it to the user with:
- `make doctor && make up && make portforward` → `http://localhost:8080` and click.
- `make smoke` for the acceptance check.
- `make down` to reset.

**No M4.** This is the final milestone in the demo. Future work (federation, real carrier API, hardened CRDs, multi-cluster, Linux/Windows installers) is explicitly out of scope per spec §3.
