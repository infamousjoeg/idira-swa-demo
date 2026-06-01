package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

// identityResp is the JSON shape returned by GET /identity on this service.
type identityResp struct {
	SANURI            string    `json:"san_uri"`
	NotBefore         time.Time `json:"not_before"`
	NotAfter          time.Time `json:"not_after"`
	KeyAlg            string    `json:"key_alg"`
	RotationMinutes   int       `json:"rotation_minutes"`
	SubjectDN         string    `json:"subject_dn"`
	IssuerDN          string    `json:"issuer_dn"`
	Serial            string    `json:"serial"`
	SigAlg            string    `json:"sig_alg"`
	FingerprintSHA256 string    `json:"fingerprint_sha256"`
}

func handleIdentity(src x509svid.Source) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		svid, err := src.GetX509SVID()
		if err != nil || svid == nil || len(svid.Certificates) == 0 {
			http.Error(w, "x509 svid unavailable", http.StatusInternalServerError)
			return
		}
		cert := svid.Certificates[0]
		rot := int(cert.NotAfter.Sub(cert.NotBefore) / time.Minute)
		subj, iss, serial, sigAlg, fp := certMetadata(cert)
		body := identityResp{
			SANURI:            svid.ID.String(),
			NotBefore:         cert.NotBefore.UTC(),
			NotAfter:          cert.NotAfter.UTC(),
			KeyAlg:            keyAlgString(cert.PublicKey),
			RotationMinutes:   rot,
			SubjectDN:         subj,
			IssuerDN:          iss,
			Serial:            serial,
			SigAlg:            sigAlg,
			FingerprintSHA256: fp,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}
}

// certMetadata extracts the cert-detail fields from an X.509 cert in a
// single pass: subject DN, issuer DN, hex serial, signature algorithm name,
// and a hex-encoded SHA-256 fingerprint of the DER bytes. Mirrors the same
// helper in apps/portal/identity.go.
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
