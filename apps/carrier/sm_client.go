package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SMClient calls the Secrets Manager - SaaS REST API for JWT auth and secret fetch.
// It performs zero base64 transformations on tokens.
type SMClient struct {
	baseURL string
	http    *http.Client
}

// AuthnJWTMeta carries request/response shape for the SM authn-jwt call.
// Feeds the sm.authn_jwt.ok trace payload (see handler.go) and the
// SM-Token card back.
//
// Token bytes are deliberately NOT captured here -- the bearer is returned
// alongside as a separate string and redacted at the emit boundary
// (apps/carrier/handler.go via redactBearer).
type AuthnJWTMeta struct {
	URL             string `json:"url"`
	Method          string `json:"method"`
	Status          int    `json:"status"`
	TokenTTLSeconds int    `json:"token_ttl_seconds"`
	Scope           string `json:"scope"`
}

// FetchSecretMeta carries request/response shape for the SM secret-fetch
// call. The secret value itself is returned separately as []byte and never
// appears in this struct -- only its byte count.
type FetchSecretMeta struct {
	URL         string `json:"url"`
	Method      string `json:"method"`
	Status      int    `json:"status"`
	SecretID    string `json:"secret_id"`
	Version     string `json:"version"`
	PolicyScope string `json:"policy_scope"`
	Bytes       int    `json:"bytes"`
}

func NewSMClient(baseURL string) *SMClient {
	return &SMClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{},
	}
}

// AuthnJWT exchanges a JWT-SVID at the secureWorkloadAccess authenticator for an
// SM access token. The returned string is the response body verbatim -- SM
// already base64-encodes it because of the Accept-Encoding: base64 header.
//
// Returns (token, meta, err). meta is populated even on error paths where
// possible (URL/Method/Status) so callers can log request shape on failure.
// TokenTTLSeconds is best-effort: 0 if the response can't be parsed.
func (c *SMClient) AuthnJWT(ctx context.Context, jwtSVID string) (string, *AuthnJWTMeta, error) {
	u := c.baseURL + "/api/authn-jwt/secureWorkloadAccess/conjur/authenticate"
	meta := &AuthnJWTMeta{URL: u, Method: http.MethodPost, Scope: "secureWorkloadAccess/conjur"}
	form := url.Values{"jwt": {jwtSVID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return "", meta, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept-Encoding", "base64")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", meta, err
	}
	defer resp.Body.Close()
	meta.Status = resp.StatusCode
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", meta, fmt.Errorf("authn-jwt: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(body) == 0 {
		return "", meta, errors.New("authn-jwt: empty token")
	}
	tok := string(body)
	meta.TokenTTLSeconds = parseExpiresIn(tok)
	return tok, meta, nil
}

// FetchSecret reads the given Conjur variable. smToken is the value returned by
// AuthnJWT; it is used verbatim in the Token header (no re-encoding).
//
// Returns (bytes, meta, err). meta is populated even on error paths where
// possible. Bytes count is the length of the response body; the value bytes
// are deliberately NOT stored in meta -- callers must use the returned
// []byte for the actual secret.
func (c *SMClient) FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, *FetchSecretMeta, error) {
	u := c.baseURL + "/api/secrets/conjur/variable/" + url.PathEscape(variableID)
	meta := &FetchSecretMeta{URL: u, Method: http.MethodGet, SecretID: variableID, PolicyScope: variableID}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, meta, err
	}
	req.Header.Set("Authorization", `Token token="`+smToken+`"`)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, meta, err
	}
	defer resp.Body.Close()
	meta.Status = resp.StatusCode
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, meta, fmt.Errorf("fetch-secret: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	meta.Bytes = len(body)
	if v := resp.Header.Get("X-Conjur-Version"); v != "" {
		meta.Version = v
	}
	return body, meta, nil
}

// parseExpiresIn best-effort decodes the SM token to extract iat/exp from the
// inner JWS payload. SM returns a base64-encoded JSON envelope of the form
// {"protected":"...","payload":"<base64>","signature":"..."} where payload
// base64-decodes to {"iat":..., "exp":..., ...}. Returns 0 if any step fails;
// the metadata consumer treats 0 as "unknown" and renders accordingly.
func parseExpiresIn(token string) int {
	// First base64-decode of the outer envelope.
	envelope, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return 0
	}
	var env struct {
		Payload string `json:"payload"`
	}
	if err := json.Unmarshal(envelope, &env); err != nil || env.Payload == "" {
		return 0
	}
	// Inner payload is base64url (no padding) JSON.
	payloadJSON, err := base64.RawURLEncoding.DecodeString(env.Payload)
	if err != nil {
		// Fall back to StdEncoding in case the SM variant uses padding.
		payloadJSON, err = base64.StdEncoding.DecodeString(env.Payload)
		if err != nil {
			return 0
		}
	}
	var claims struct {
		Iat int64 `json:"iat"`
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return 0
	}
	if claims.Exp <= claims.Iat {
		return 0
	}
	return int(claims.Exp - claims.Iat)
}
