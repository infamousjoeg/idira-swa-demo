package main

import "time"

// identityResp mirrors apps/carrier/identity.go. Kept duplicated rather than
// imported across go.mod boundaries — spec §3 of the original design forbids
// extracting a shared module for 50 lines of struct.
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
