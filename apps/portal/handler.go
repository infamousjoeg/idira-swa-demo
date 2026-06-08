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

// externalAPI is the surface handleResolve needs from ExternalCarrierClient.
// Defined as an interface so handler_test.go can substitute a stub without
// standing up a TLS handshake.
type externalAPI interface {
	Resolve(ctx context.Context, shipmentID string) error
}

var errCarrierDown = errors.New("carrier unreachable")

type resolveReq struct {
	ShipmentID string `json:"shipment_id"`
	// Carrier selects which backend the resolve targets. Empty defaults to
	// "internal" in handleResolve so M1-M6 JS clients (which omit the field)
	// keep working. "external" routes to the Acme client added in M7.
	Carrier string `json:"carrier,omitempty"`
}

func handleResolve(c carrierAPI, x externalAPI, bus *TraceBus) http.HandlerFunc {
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
		carrier := req.Carrier
		if carrier == "" {
			carrier = "internal"
		}
		bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.requested",
			Payload: map[string]any{"id": req.ShipmentID, "carrier": carrier}})

		if carrier == "external" {
			if err := x.Resolve(r.Context(), req.ShipmentID); err != nil {
				bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.rejected",
					Payload: map[string]any{"reason": "trust_boundary"}})
				http.Error(w, "external carrier rejected at trust boundary", http.StatusBadGateway)
				return
			}
			// Unexpected success -- still 502 because the demo expects rejection.
			bus.Emit(traceEvent{Source: "portal", Type: "portal.resolve.rejected",
				Payload: map[string]any{"reason": "unexpected_ok"}})
			http.Error(w, "external carrier handshake unexpectedly succeeded", http.StatusBadGateway)
			return
		}

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
