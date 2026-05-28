package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

// carrierAPI is the surface the /resolve handler needs from the mTLS carrier
// client. Defined as an interface so handler_test.go can substitute a stub
// without standing up a TLS handshake.
type carrierAPI interface {
	Lookup(ctx context.Context, shipmentID string) (body []byte, code int, err error)
}

var errCarrierDown = errors.New("carrier unreachable")

type resolveReq struct {
	ShipmentID string `json:"shipment_id"`
}

func handleResolve(c carrierAPI, bus *TraceBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req resolveReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ShipmentID == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.requested",
			Payload: map[string]any{"id": req.ShipmentID}})

		body, code, err := c.Lookup(r.Context(), req.ShipmentID)
		if err != nil {
			bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.error",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "carrier error", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write(body)
	}
}
