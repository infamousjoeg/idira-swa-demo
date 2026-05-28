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

// shipmentIDRE matches the canonical SHP-... shape and rejects anything with
// path-traversal or whitespace characters. Validation runs before the network
// call so we don't even pretend to attempt unsafe URLs.
var shipmentIDRE = regexp.MustCompile(`^SHP-[A-Za-z0-9-]+$`)

// CarrierClient calls the carrier service over mTLS and subscribes to its
// trace SSE stream during each request.
type CarrierClient struct {
	baseURL  string // https://<host>:8443
	traceURL string // https://<host>:8444/trace
	http     *http.Client
	bus      *TraceBus
}

// NewCarrierClient builds an mTLS-secured client that trusts only the peer
// SPIFFE ID provided. Both the call-path client and the trace-path client
// share the same TLS config (same SVID, same authorizer) — spec §9.3 & §9.4.
//
// AuthorizeID, not AuthorizeAny or AuthorizeMemberOf — spec §13.4 #4 and the
// builder constraints (no wildcard mTLS authorizer).
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

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/lookup/"+url.PathEscape(shipmentID), nil)
	if err != nil {
		return nil, 0, err
	}
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

// streamCarrierTrace opens an SSE-like read against carrier:/trace and
// republishes every received "data: …" frame into the portal's bus, tagged
// as source=carrier so the inspector renders both sources in one timeline.
func (c *CarrierClient) streamCarrierTrace(ctx context.Context) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.traceURL, nil)
	if err != nil {
		return
	}
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
