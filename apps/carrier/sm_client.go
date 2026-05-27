package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// SMClient calls the Secrets Manager – SaaS REST API for JWT auth and secret fetch.
// It performs zero base64 transformations on tokens.
type SMClient struct {
	baseURL string
	http    *http.Client
}

func NewSMClient(baseURL string) *SMClient {
	return &SMClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{},
	}
}

// AuthnJWT exchanges a JWT-SVID at the secureWorkloadAccess authenticator for an
// SM access token. The returned string is the response body verbatim — SM
// already base64-encodes it because of the Accept-Encoding: base64 header.
func (c *SMClient) AuthnJWT(ctx context.Context, jwtSVID string) (string, error) {
	form := url.Values{"jwt": {jwtSVID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/api/authn-jwt/secureWorkloadAccess/conjur/authenticate",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept-Encoding", "base64")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("authn-jwt: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(body) == 0 {
		return "", errors.New("authn-jwt: empty token")
	}
	return string(body), nil
}

// FetchSecret reads the given Conjur variable. smToken is the value returned by
// AuthnJWT; it is used verbatim in the Token header (no re-encoding).
func (c *SMClient) FetchSecret(ctx context.Context, smToken, variableID string) ([]byte, error) {
	u := c.baseURL + "/api/secrets/conjur/variable/" + url.PathEscape(variableID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", `Token token="`+smToken+`"`)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch-secret: %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
