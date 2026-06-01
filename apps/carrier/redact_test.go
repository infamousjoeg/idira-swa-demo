package main

import (
	"strings"
	"testing"
)

// TestRedactBearer_Short asserts the redactor leaves under-4-char inputs
// untouched (they're not real tokens; trying to "redact" them would just
// add noise).
func TestRedactBearer_Short(t *testing.T) {
	if got := redactBearer(""); got != "" {
		t.Errorf("empty should stay empty, got %q", got)
	}
	if got := redactBearer("abc"); got != "abc" {
		t.Errorf("short tokens (under 4 chars) returned as-is, got %q", got)
	}
}

// TestRedactBearer_Long asserts the display form preserves the first 4
// chars (enough to disambiguate runs in a log without revealing the secret)
// followed by the ...REDACTED marker, and that nothing from the rest of the
// token leaks through.
func TestRedactBearer_Long(t *testing.T) {
	got := redactBearer("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.fakesig")
	if !strings.HasPrefix(got, "eyJh") {
		t.Errorf("expected first 4 chars preserved, got %q", got)
	}
	if !strings.HasSuffix(got, "...REDACTED") {
		t.Errorf("expected ...REDACTED suffix, got %q", got)
	}
	if strings.Contains(got, "fakesig") {
		t.Errorf("redacted token must not contain anything past the 4-char prefix, got %q", got)
	}
}
