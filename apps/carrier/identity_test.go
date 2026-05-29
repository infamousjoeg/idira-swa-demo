package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

type stubX509Source struct {
	svid *x509svid.SVID
	err  error
}

func (s stubX509Source) GetX509SVID() (*x509svid.SVID, error) { return s.svid, s.err }

func makeRSATestSVID(t *testing.T, id string, ttl time.Duration) *x509svid.SVID {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	uri, _ := url.Parse(id)
	notBefore := time.Unix(1748000000, 0)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test"},
		NotBefore:    notBefore,
		NotAfter:     notBefore.Add(ttl),
		URIs:         []*url.URL{uri},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(der)
	sid, _ := spiffeid.FromString(id)
	return &x509svid.SVID{ID: sid, Certificates: []*x509.Certificate{cert}, PrivateKey: key}
}

func TestIdentity_ReturnsCarrierSVIDDetails(t *testing.T) {
	svid := makeRSATestSVID(t, "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier", 60*time.Minute)
	src := stubX509Source{svid: svid}

	req := httptest.NewRequest(http.MethodGet, "/identity", nil)
	w := httptest.NewRecorder()
	handleIdentity(src)(w, req)

	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got identityResp
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.SANURI != "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier" {
		t.Errorf("san_uri=%s", got.SANURI)
	}
	if got.KeyAlg != "RSA-2048" {
		t.Errorf("key_alg=%s", got.KeyAlg)
	}
	if got.RotationMinutes != 60 {
		t.Errorf("rotation_minutes=%d", got.RotationMinutes)
	}
}

func TestIdentity_ECDSAKeyReportedAsECCurveName(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	uri, _ := url.Parse("spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier")
	notBefore := time.Unix(1748000000, 0)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), NotBefore: notBefore,
		NotAfter: notBefore.Add(time.Hour), URIs: []*url.URL{uri},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(der)
	sid, _ := spiffeid.FromString("spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier")
	svid := &x509svid.SVID{ID: sid, Certificates: []*x509.Certificate{cert}, PrivateKey: key}

	req := httptest.NewRequest(http.MethodGet, "/identity", nil)
	w := httptest.NewRecorder()
	handleIdentity(stubX509Source{svid: svid})(w, req)

	var got identityResp
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got.KeyAlg != "EC-P-256" {
		t.Errorf("key_alg=%s", got.KeyAlg)
	}
}

func TestIdentity_SourceErrorReturns500(t *testing.T) {
	w := httptest.NewRecorder()
	handleIdentity(stubX509Source{err: http.ErrServerClosed})(w, httptest.NewRequest("GET", "/identity", nil))
	if w.Code != 500 {
		t.Errorf("status=%d", w.Code)
	}
}
