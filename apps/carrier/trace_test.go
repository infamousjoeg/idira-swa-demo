package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBus_SubscribeReceivesEmittedEvents(t *testing.T) {
	b := NewTraceBus(4)
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	b.Emit(traceEvent{Source: "carrier", Type: "x.y", Payload: map[string]any{"k": "v"}})

	select {
	case ev := <-ch:
		if ev.Type != "x.y" {
			t.Errorf("type: %s", ev.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("no event received")
	}
}

func TestBus_SlowConsumerDoesNotBlockEmit(t *testing.T) {
	b := NewTraceBus(2) // tiny buffer
	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	// Fill the buffer + 2 extra. Emit must not block.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 5; i++ {
			b.Emit(traceEvent{Type: "x"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Emit blocked on slow consumer")
	}
}

func TestSSE_EmitsDataFramesAsJSON(t *testing.T) {
	b := NewTraceBus(16)
	srv := httptest.NewServer(handleTraceSSE(b))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("content-type: %s", got)
	}

	go func() {
		time.Sleep(50 * time.Millisecond)
		b.Emit(traceEvent{Source: "carrier", Type: "boot"})
	}()

	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	frame := string(buf[:n])
	if !strings.HasPrefix(frame, "data: ") {
		t.Fatalf("expected data frame, got %q", frame)
	}
	// Strip "data: " prefix and "\n\n" suffix and ensure it parses as our event JSON.
	payload := strings.TrimSpace(strings.TrimPrefix(frame, "data: "))
	var ev map[string]any
	if err := json.NewDecoder(bytes.NewReader([]byte(payload))).Decode(&ev); err != nil {
		t.Fatalf("decode SSE frame: %v frame=%q", err, frame)
	}
	if ev["type"] != "boot" {
		t.Errorf("type in frame: %v", ev["type"])
	}
}
