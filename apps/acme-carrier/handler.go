package main

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"strings"
)

//go:embed fixture/parcels.json
var parcelsJSON []byte

type parcel struct {
	ParcelID    string `json:"parcel_id"`
	Origin      string `json:"origin"`
	Destination string `json:"destination"`
	ETA         string `json:"eta"`
	CarrierName string `json:"carrier_name"`
}

// lookupHandler serves /lookup/{id} from a static fixture. In the happy M7
// demo flow this handler is never reached because the portal's verifier
// rejects Acme's cert chain before TLS completes. It exists for completeness
// and so curl --insecure from inside the cluster can prove the service is up.
func lookupHandler() http.HandlerFunc {
	var parcels map[string]parcel
	if err := json.Unmarshal(parcelsJSON, &parcels); err != nil {
		// Compile-time fixture, surface immediately if malformed.
		panic("acme-carrier: cannot unmarshal embedded parcels.json: " + err.Error())
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/lookup/")
		p, ok := parcels[id]
		if !ok {
			http.Error(w, "parcel not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(p)
	}
}
