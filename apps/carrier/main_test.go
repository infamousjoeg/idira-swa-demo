package main

import (
	"os"
	"strings"
	"testing"
)

// Wildcard mTLS trust is explicitly forbidden in this demo. This is a
// grep-based source check rather than a runtime assertion because the
// authorizer is wired up inside run() which depends on a Workload API
// socket the unit-test env doesn't have. AuthorizeID is the only
// authorizer that may appear; this test fails fast at build time if a
// future edit reintroduces AuthorizeAny / AuthorizeMemberOf.
func TestMTLSAuthorizerIsExplicit(t *testing.T) {
	src := mustReadFile(t, "main.go")
	if !strings.Contains(src, "tlsconfig.AuthorizeID(") {
		t.Errorf("main.go must use tlsconfig.AuthorizeID")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeAny(") {
		t.Errorf("main.go uses AuthorizeAny: wildcard mTLS trust forbidden in this demo")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeMemberOf(") {
		t.Errorf("main.go uses AuthorizeMemberOf: too permissive for this demo")
	}
}

func mustReadFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
