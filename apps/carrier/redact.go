package main

// redactBearer returns a safe display form of a bearer token: first 4
// characters followed by "…REDACTED". Used at the trace-emission layer
// in handler.go so the full token never reaches the frontend. Tokens
// under 4 characters are returned as-is (they're not real tokens).
//
// Spec §6.2 of docs/superpowers/specs/2026-05-29-flip-card-detail-view-design.md
// and validator §13.4 #4: redaction is enforced at the Go wire-emission
// boundary, NEVER in the UI. See apps/carrier/handler.go for the call site.
func redactBearer(token string) string {
	if len(token) < 4 {
		return token
	}
	return token[:4] + "…REDACTED"
}
