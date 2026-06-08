package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"net/url"
	"time"
)

const acmeSPIFFEURI = "spiffe://acme.courier/carrier/parcel"

// mintIdentity generates a self-signed CA and a leaf cert signed by that CA.
// The leaf carries one SAN URI: spiffe://acme.courier/carrier/parcel. The
// returned tls.Certificate contains the leaf at index 0 and the CA at index 1,
// so peers see the full chain -- which still does NOT verify, because the CA
// is not present in the portal's SWA trust bundle. That non-verification is
// the whole point of M7.
func mintIdentity() (*tls.Certificate, error) {
	// --- CA ---
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("ca key: %w", err)
	}
	caSerial, err := randomSerial()
	if err != nil {
		return nil, fmt.Errorf("ca serial: %w", err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          caSerial,
		Subject:               pkix.Name{CommonName: "acme.courier root"},
		NotBefore:             time.Now().Add(-1 * time.Minute),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create ca cert: %w", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return nil, fmt.Errorf("parse ca cert: %w", err)
	}

	// --- Leaf ---
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("leaf key: %w", err)
	}
	leafSerial, err := randomSerial()
	if err != nil {
		return nil, fmt.Errorf("leaf serial: %w", err)
	}
	spiffeURI, err := url.Parse(acmeSPIFFEURI)
	if err != nil {
		return nil, fmt.Errorf("parse spiffe uri: %w", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: leafSerial,
		Subject:      pkix.Name{}, // empty -- SPIFFE identity lives in SAN URI
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		URIs:         []*url.URL{spiffeURI},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create leaf cert: %w", err)
	}

	return &tls.Certificate{
		Certificate: [][]byte{leafDER, caDER},
		PrivateKey:  leafKey,
	}, nil
}

func randomSerial() (*big.Int, error) {
	max := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, max)
}
