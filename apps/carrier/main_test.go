package main

import (
	"os"
	"strings"
	"testing"
)

// Spec §13.4 #4 forbids wildcard mTLS trust. This is a grep-based source
// check rather than a runtime assertion because the authorizer is wired up
// inside run() which depends on a Workload API socket the unit-test env
// doesn't have. The validator's PASS criterion is that AuthorizeID is the
// only authorizer used; this test fails fast at build time if a future
// edit reintroduces AuthorizeAny / AuthorizeMemberOf.
func TestMTLSAuthorizerIsExplicit(t *testing.T) {
	src := mustReadFile(t, "main.go")
	if !strings.Contains(src, "tlsconfig.AuthorizeID(") {
		t.Errorf("main.go must use tlsconfig.AuthorizeID")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeAny(") {
		t.Errorf("main.go uses AuthorizeAny — forbidden by spec §13.4 #4")
	}
	if strings.Contains(src, "tlsconfig.AuthorizeMemberOf(") {
		t.Errorf("main.go uses AuthorizeMemberOf — too permissive for this demo")
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
