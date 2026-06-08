package main

import (
	"crypto/tls"
	"crypto/x509"
	"testing"
	"time"
)

func TestMintIdentity_SANIsSPIFFEURI(t *testing.T) {
	cert, err := mintIdentity()
	if err != nil {
		t.Fatalf("mintIdentity: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if len(leaf.URIs) != 1 {
		t.Fatalf("want 1 URI SAN, got %d", len(leaf.URIs))
	}
	if got, want := leaf.URIs[0].String(), "spiffe://acme.courier/carrier/parcel"; got != want {
		t.Errorf("SAN URI = %q, want %q", got, want)
	}
}

func TestMintIdentity_SubjectIsEmpty(t *testing.T) {
	cert, err := mintIdentity()
	if err != nil {
		t.Fatalf("mintIdentity: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if leaf.Subject.String() != "" {
		t.Errorf("Subject = %q, want empty (SPIFFE identity lives in SAN URI)", leaf.Subject.String())
	}
}

func TestMintIdentity_LeafChainsToOwnCA(t *testing.T) {
	cert, err := mintIdentity()
	if err != nil {
		t.Fatalf("mintIdentity: %v", err)
	}
	// We expect Certificate[0] = leaf, Certificate[1] = CA.
	if len(cert.Certificate) != 2 {
		t.Fatalf("want 2-entry chain (leaf + CA), got %d", len(cert.Certificate))
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	ca, err := x509.ParseCertificate(cert.Certificate[1])
	if err != nil {
		t.Fatalf("parse CA: %v", err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:       pool,
		CurrentTime: time.Now(),
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}); err != nil {
		t.Errorf("leaf does not chain to its own CA: %v", err)
	}
}

func TestMintIdentity_LeafIsTLSCertificate(t *testing.T) {
	cert, err := mintIdentity()
	if err != nil {
		t.Fatalf("mintIdentity: %v", err)
	}
	// Must be usable as a tls.Certificate (cert.PrivateKey non-nil).
	if cert.PrivateKey == nil {
		t.Error("PrivateKey is nil; cert is not usable as a tls.Certificate")
	}
	_ = tls.Certificate(*cert) // compile-time assertion
}

func TestMintIdentity_LeafHasClusterDNSName(t *testing.T) {
	cert, err := mintIdentity()
	if err != nil {
		t.Fatalf("mintIdentity: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	want := "acme-carrier.acme-external.svc.cluster.local"
	found := false
	for _, name := range leaf.DNSNames {
		if name == want {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("leaf DNSNames = %v, want to contain %q (so Go's hostname check passes and chain validation is what fails)", leaf.DNSNames, want)
	}
}
