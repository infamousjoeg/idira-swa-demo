package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

type stubCarrierIdentity struct {
	resp  *identityResp
	err   error
	calls int32
}

func (s *stubCarrierIdentity) Identity(_ context.Context) (*identityResp, error) {
	atomic.AddInt32(&s.calls, 1)
	return s.resp, s.err
}

// stubLocalX509 is a minimal X509Source for the portal aggregator tests.
type stubLocalX509 struct {
	svid *x509svid.SVID
	err  error
}

func (s stubLocalX509) GetX509SVID() (*x509svid.SVID, error) { return s.svid, s.err }

func TestIdentityAggregator_HappyPath(t *testing.T) {
	portalSVID := makePortalTestSVID(t)
	carrier := &stubCarrierIdentity{resp: &identityResp{
		SANURI:          "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier",
		NotBefore:       time.Unix(1748000000, 0),
		NotAfter:        time.Unix(1748003600, 0),
		KeyAlg:          "RSA-2048",
		RotationMinutes: 60,
	}}
	agg := newIdentityAggregator(stubLocalX509{svid: portalSVID}, carrier,
		identityConfig{ServerGroup: "kind-sg", Attestor: "k8s_psat", SecretID: "swa-demo/carrier/api-key"})

	req := httptest.NewRequest(http.MethodGet, "/identity", nil)
	w := httptest.NewRecorder()
	agg.handler()(w, req)

	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got identityFullResp
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.TrustDomain != "idira.demo" {
		t.Errorf("trust_domain=%s", got.TrustDomain)
	}
	if got.NodeGroup != "kind-ng" {
		t.Errorf("node_group=%s", got.NodeGroup)
	}
	if got.ServerGroup != "kind-sg" {
		t.Errorf("server_group=%s", got.ServerGroup)
	}
	if got.Attestor != "k8s_psat" {
		t.Errorf("attestor=%s", got.Attestor)
	}
	if got.SecretID != "swa-demo/carrier/api-key" {
		t.Errorf("secret_id=%s", got.SecretID)
	}
	if got.PortalSVID == nil || got.CarrierSVID == nil {
		t.Errorf("missing svid fields: portal=%v carrier=%v", got.PortalSVID, got.CarrierSVID)
	}
	if got.PortalSVID.SANURI != "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal" {
		t.Errorf("portal san_uri=%s", got.PortalSVID.SANURI)
	}
}

func TestIdentityAggregator_CarrierDown(t *testing.T) {
	carrier := &stubCarrierIdentity{err: errors.New("carrier down")}
	agg := newIdentityAggregator(stubLocalX509{svid: makePortalTestSVID(t)}, carrier,
		identityConfig{ServerGroup: "kind-sg", Attestor: "k8s_psat", SecretID: "swa-demo/carrier/api-key"})
	w := httptest.NewRecorder()
	agg.handler()(w, httptest.NewRequest("GET", "/identity", nil))

	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var got identityFullResp
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.CarrierSVID != nil {
		t.Errorf("expected nil carrier_svid; got %+v", got.CarrierSVID)
	}
	if got.Warning == "" {
		t.Errorf("expected non-empty warning when carrier unreachable")
	}
}

func TestIdentityAggregator_CachesCarrierFor30s(t *testing.T) {
	now := time.Unix(1748000000, 0)
	carrier := &stubCarrierIdentity{resp: &identityResp{SANURI: "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier"}}
	agg := newIdentityAggregator(stubLocalX509{svid: makePortalTestSVID(t)}, carrier,
		identityConfig{ServerGroup: "kind-sg", Attestor: "k8s_psat", SecretID: "swa-demo/carrier/api-key"})
	agg.now = func() time.Time { return now }

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		agg.handler()(w, httptest.NewRequest("GET", "/identity", nil))
	}
	if got := atomic.LoadInt32(&carrier.calls); got != 1 {
		t.Errorf("expected 1 carrier call within 30s window; got %d", got)
	}
	// Advance 31s; next call must refresh.
	agg.now = func() time.Time { return now.Add(31 * time.Second) }
	w := httptest.NewRecorder()
	agg.handler()(w, httptest.NewRequest("GET", "/identity", nil))
	if got := atomic.LoadInt32(&carrier.calls); got != 2 {
		t.Errorf("expected refresh after TTL; got %d", got)
	}
}

func makePortalTestSVID(t *testing.T) *x509svid.SVID {
	return makeRSATestSVID(t, "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal", time.Hour)
}

// TestIdentity_IncludesCertMetadata asserts the M6 cert-metadata fields are
// populated on portal_svid from the underlying X.509 cert. Spec §5 of the
// 2026-05-29 flip-card-detail-view design + plan Task 1.
func TestIdentity_IncludesCertMetadata(t *testing.T) {
	carrier := &stubCarrierIdentity{resp: &identityResp{
		SANURI:            "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier",
		SubjectDN:         "CN=carrier",
		IssuerDN:          "CN=carrier",
		Serial:            "1",
		SigAlg:            "SHA256-RSA",
		FingerprintSHA256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
	}}
	agg := newIdentityAggregator(stubLocalX509{svid: makePortalTestSVID(t)}, carrier,
		identityConfig{ServerGroup: "kind-sg", Attestor: "k8s_psat", SecretID: "swa-demo/carrier/api-key"})

	req := httptest.NewRequest(http.MethodGet, "/identity", nil)
	w := httptest.NewRecorder()
	agg.handler()(w, req)

	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got identityFullResp
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.PortalSVID == nil {
		t.Fatal("portal_svid missing")
	}
	p := got.PortalSVID
	if p.SubjectDN == "" {
		t.Error("portal_svid.subject_dn empty")
	}
	if p.IssuerDN == "" {
		t.Error("portal_svid.issuer_dn empty")
	}
	if p.Serial == "" {
		t.Error("portal_svid.serial empty")
	}
	if p.SigAlg == "" {
		t.Error("portal_svid.sig_alg empty")
	}
	if len(p.FingerprintSHA256) != 64 {
		t.Errorf("portal_svid.fingerprint_sha256 must be 64 hex chars; got %d (%q)", len(p.FingerprintSHA256), p.FingerprintSHA256)
	}
	// carrier_svid pass-through from the stub above must also surface the
	// fields (proves the aggregator preserves them on the wire).
	if got.CarrierSVID == nil || got.CarrierSVID.FingerprintSHA256 == "" {
		t.Errorf("carrier_svid cert metadata not preserved: %+v", got.CarrierSVID)
	}
}
