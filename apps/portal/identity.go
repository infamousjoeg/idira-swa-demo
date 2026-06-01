package main

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

// carrierIdentitySource is the surface the aggregator needs from CarrierClient.
// Defined as an interface so tests can substitute a stub without TLS setup.
type carrierIdentitySource interface {
	Identity(ctx context.Context) (*identityResp, error)
}

type identityConfig struct {
	ServerGroup string
	Attestor    string
	SecretID    string
}

// identityFullResp is the JSON shape served at portal /identity.
type identityFullResp struct {
	TrustDomain string        `json:"trust_domain"`
	ServerGroup string        `json:"server_group"`
	NodeGroup   string        `json:"node_group"`
	Attestor    string        `json:"attestor"`
	SecretID    string        `json:"secret_id"`
	PortalSVID  *identityResp `json:"portal_svid"`
	CarrierSVID *identityResp `json:"carrier_svid"`
	Warning     string        `json:"warning,omitempty"`
}

const carrierCacheTTL = 30 * time.Second

type identityAggregator struct {
	local  x509svid.Source
	remote carrierIdentitySource
	cfg    identityConfig
	now    func() time.Time

	mu         sync.Mutex
	cachedAt   time.Time
	cachedResp *identityResp
	cachedErr  error
}

func newIdentityAggregator(local x509svid.Source, remote carrierIdentitySource, cfg identityConfig) *identityAggregator {
	return &identityAggregator{local: local, remote: remote, cfg: cfg, now: time.Now}
}

func (a *identityAggregator) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		full, code := a.snapshot(r.Context())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(full)
	}
}

func (a *identityAggregator) snapshot(ctx context.Context) (identityFullResp, int) {
	out := identityFullResp{
		ServerGroup: a.cfg.ServerGroup,
		Attestor:    a.cfg.Attestor,
		SecretID:    a.cfg.SecretID,
	}
	// Local SVID
	psvid, err := a.local.GetX509SVID()
	if err != nil || psvid == nil || len(psvid.Certificates) == 0 {
		// Portal can't read its own SVID -- return 503 with empty body fields.
		return out, http.StatusServiceUnavailable
	}
	pcert := psvid.Certificates[0]
	subj, iss, serial, sigAlg, fp := certMetadata(pcert)
	out.PortalSVID = &identityResp{
		SANURI:            psvid.ID.String(),
		NotBefore:         pcert.NotBefore.UTC(),
		NotAfter:          pcert.NotAfter.UTC(),
		KeyAlg:            keyAlgString(pcert.PublicKey),
		RotationMinutes:   int(pcert.NotAfter.Sub(pcert.NotBefore) / time.Minute),
		SubjectDN:         subj,
		IssuerDN:          iss,
		Serial:            serial,
		SigAlg:            sigAlg,
		FingerprintSHA256: fp,
	}
	out.TrustDomain = psvid.ID.TrustDomain().String()
	out.NodeGroup = firstPathSegment(psvid.ID.Path())

	// Carrier SVID (cached 30s).
	cresp, cerr := a.carrierCached(ctx)
	if cerr != nil {
		out.Warning = "carrier unreachable: " + cerr.Error()
	} else {
		out.CarrierSVID = cresp
	}
	return out, http.StatusOK
}

func (a *identityAggregator) carrierCached(ctx context.Context) (*identityResp, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cachedResp != nil && a.now().Sub(a.cachedAt) < carrierCacheTTL {
		return a.cachedResp, a.cachedErr
	}
	resp, err := a.remote.Identity(ctx)
	a.cachedAt = a.now()
	a.cachedResp = resp
	a.cachedErr = err
	return resp, err
}

// firstPathSegment parses "/kind-ng/ns/swa-demo/sa/portal" → "kind-ng".
func firstPathSegment(path string) string {
	trimmed := strings.TrimPrefix(path, "/")
	if i := strings.IndexByte(trimmed, '/'); i >= 0 {
		return trimmed[:i]
	}
	return trimmed
}

// certMetadata extracts the cert-detail fields from an X.509 cert in a
// single pass: subject DN, issuer DN, hex serial, signature algorithm name,
// and a hex-encoded SHA-256 fingerprint of the DER bytes. Mirrors the same
// helper in apps/carrier/identity.go.
func certMetadata(cert *x509.Certificate) (subj, iss, serial, sigAlg, fingerprint string) {
	if cert == nil {
		return "", "", "", "", ""
	}
	subj = cert.Subject.String()
	iss = cert.Issuer.String()
	if cert.SerialNumber != nil {
		serial = cert.SerialNumber.Text(16)
	}
	sigAlg = cert.SignatureAlgorithm.String()
	sum := sha256.Sum256(cert.Raw)
	fingerprint = hex.EncodeToString(sum[:])
	return subj, iss, serial, sigAlg, fingerprint
}

// keyAlgString duplicates the carrier-side helper. Same justification as identityResp.
func keyAlgString(pub crypto.PublicKey) string {
	switch k := pub.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA-%d", k.N.BitLen())
	case *ecdsa.PublicKey:
		return fmt.Sprintf("EC-%s", k.Curve.Params().Name)
	default:
		return "unknown"
	}
}
