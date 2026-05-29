package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/x509svid"
)

// identityResp is the JSON shape returned by GET /identity on this service.
// Spec: §5.5 of docs/superpowers/specs/2026-05-28-svid-trust-panel-design.md.
type identityResp struct {
	SANURI          string    `json:"san_uri"`
	NotBefore       time.Time `json:"not_before"`
	NotAfter        time.Time `json:"not_after"`
	KeyAlg          string    `json:"key_alg"`
	RotationMinutes int       `json:"rotation_minutes"`
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
		body := identityResp{
			SANURI:          svid.ID.String(),
			NotBefore:       cert.NotBefore.UTC(),
			NotAfter:        cert.NotAfter.UTC(),
			KeyAlg:          keyAlgString(cert.PublicKey),
			RotationMinutes: rot,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}
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
