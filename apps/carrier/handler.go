package main

import (
	"context"
	"embed"
	"encoding/base64"
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
	AuthnJWT(ctx context.Context, jwtSVID string) (string, *AuthnJWTMeta, error)
	FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, *FetchSecretMeta, error)
}

type handlerDeps struct {
	wl       jwtSource
	sm       smAPI
	secretID string
	bus      *TraceBus
	now      func() time.Time
	algKid   func(token string) (alg, kid string) // injectable for tests; defaults to parseJWTHeader
}

// parseJWTHeader extracts alg and kid from a compact JWT's first segment.
// Returns ("", "") on any parse failure — emit-side falls back gracefully.
func parseJWTHeader(token string) (alg, kid string) {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) < 2 {
		return "", ""
	}
	hdrJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", ""
	}
	var h struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(hdrJSON, &h); err != nil {
		return "", ""
	}
	return h.Alg, h.Kid
}

// decodeJWTClaims base64url-decodes the body segment of a compact JWT and
// returns the parsed JSON object. Used to extract iss/iat/jti for the M6
// jwt_svid.issued payload extension. Returns nil on any parse failure.
func decodeJWTClaims(token string) map[string]any {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) < 2 {
		return nil
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil
	}
	return out
}

// parseJWTType reads the JOSE header's "typ" field. Returns "" on any parse
// failure; callers should fall back to "JWT" when displaying.
func parseJWTType(token string) string {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) < 2 {
		return ""
	}
	hdr, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ""
	}
	var h struct {
		Typ string `json:"typ"`
	}
	if err := json.Unmarshal(hdr, &h); err != nil {
		return ""
	}
	return h.Typ
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
		algFn := d.algKid
		if algFn == nil {
			algFn = parseJWTHeader
		}
		alg, kid := algFn(svid.Marshal())
		raw := svid.Marshal()
		claims := decodeJWTClaims(raw)
		typ := parseJWTType(raw)
		d.bus.Emit(traceEvent{Source: "carrier", Type: "jwt_svid.issued",
			Payload: map[string]any{
				"aud":       "conjur",
				"exp":       svid.Expiry.Unix(),
				"spiffe_id": svid.ID.String(),
				"alg":       alg,
				"kid":       kid,
				"iss":       claims["iss"],
				"iat":       claims["iat"],
				"jti":       claims["jti"],
				"typ":       typ,
				"raw":       raw,
			}})

		smTok, smMeta, err := d.sm.AuthnJWT(ctx, svid.Marshal())
		if err != nil {
			d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.err",
				Payload: map[string]any{"err": err.Error()}})
			http.Error(w, "identity rejected", http.StatusBadGateway)
			return
		}
		// REDACTION DISCIPLINE: the full bearer token (smTok) is NEVER emitted.
		// Only redactBearer(smTok) reaches the trace bus. Spec §6.2 + validator
		// §13.4 #4. token_len is kept for backward compat with the M5 evidence
		// wiring that reads it for the trust-card byte count.
		d.bus.Emit(traceEvent{Source: "carrier", Type: "sm.authn_jwt.ok",
			Payload: map[string]any{
				"url":               smMeta.URL,
				"method":            smMeta.Method,
				"status":            smMeta.Status,
				"token_redacted":    redactBearer(smTok),
				"token_ttl_seconds": smMeta.TokenTTLSeconds,
				"scope":             smMeta.Scope,
				"token_len":         len(smTok),
			}})

		secret, _, err := d.sm.FetchSecret(ctx, smTok, d.secretID)
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
		// Metadata is captured but not yet emitted here -- Task 6 wires the
		// full sm.secret_fetched.ok payload with no-leak metadata.
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
