package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/spiffe/go-spiffe/v2/svid/jwtsvid"
)

// Interfaces let main.go pass real impls and tests pass stubs.
type jwtSource interface {
	FetchJWTSVID(ctx context.Context, p jwtsvid.Params) (*jwtsvid.SVID, error)
}

type smAPI interface {
	AuthnJWT(ctx context.Context, jwtSVID string) (string, error)
	FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, error)
}

type handlerDeps struct {
	wl       jwtSource
	sm       smAPI
	secretID string
	bus      *TraceBus
	now      func() time.Time
}

// Fixture data lives in apps/carrier/fixture/. Loaded once on first use.
var (
	fixturesOnce sync.Once
	fixtures     map[string]map[string]any
)

func loadFixturesFromFS(fsys fs.FS) {
	fixturesOnce.Do(func() {
		f, err := fsys.Open(filepath.Join("fixture", "shipments.json"))
		if err != nil {
			fixtures = map[string]map[string]any{}
			return
		}
		defer f.Close()
		_ = json.NewDecoder(f).Decode(&fixtures)
	})
}

//go:embed fixture/shipments.json
var embeddedFixtures embed.FS

func handleLookup(d handlerDeps) http.HandlerFunc {
	loadFixturesFromFS(embeddedFixtures)
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/lookup/")
		if id == "" || strings.Contains(id, "/") {
			http.Error(w, "bad shipment id", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		d.bus.Emit(traceEvent{Source: "carrier", Type: "request.received",
			Payload: map[string]any{"id": id}})

		svid, err := d.wl.FetchJWTSVID(ctx, jwtsvid.Params{Audience: "conjur"})
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "jwt_svid.error",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "agent unreachable", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "jwt_svid.issued",
			Payload: map[string]any{"aud": "conjur", "exp": svid.Expiry.Unix(),
				"spiffe_id": svid.ID.String()}})

		smTok, err := d.sm.AuthnJWT(ctx, svid.Marshal())
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.err",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "identity rejected", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.ok",
			Payload: map[string]any{"token_len": len(smTok)}})

		secret, err := d.sm.FetchSecret(ctx, smTok, d.secretID)
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.err",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "policy denies access", http.StatusBadGateway)
			return
		}
		if len(secret) == 0 {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.empty"})
			http.Error(w, "empty secret", http.StatusBadGateway)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.secret_fetched.ok",
			Payload: map[string]any{"bytes": len(secret)}})

		row, ok := fixtures[id]
		if !ok {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "carrier.lookup.miss",
				Payload: map[string]any{"id": id}})
			http.Error(w, "shipment not found", http.StatusNotFound)
			return
		}
		d.bus.Emit(traceEvent{Source: "carrier", Type: "carrier.lookup.ok",
			Payload: map[string]any{"id": id}})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(row)
	}
}
