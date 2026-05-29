package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net/url"
	"testing"
	"time"

	"github.com/spiffe/go-spiffe/v2/spiffeid"
	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

func makeRSATestSVID(t *testing.T, id string, ttl time.Duration) *x509svid.SVID {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	uri, _ := url.Parse(id)
	nb := time.Unix(1748000000, 0)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test"},
		NotBefore: nb, NotAfter: nb.Add(ttl), URIs: []*url.URL{uri},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	cert, _ := x509.ParseCertificate(der)
	sid, _ := spiffeid.FromString(id)
	return &x509svid.SVID{ID: sid, Certificates: []*x509.Certificate{cert}, PrivateKey: key}
}
