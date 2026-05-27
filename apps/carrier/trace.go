package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

type traceEvent struct {
	TS      time.Time      `json:"ts"`
	Source  string         `json:"source"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload,omitempty"`
}

// TraceBus is a fan-out, drop-on-slow-consumer event bus.
type TraceBus struct {
	mu      sync.Mutex
	subs    map[chan traceEvent]struct{}
	bufSize int
}

func NewTraceBus(bufSize int) *TraceBus {
	if bufSize < 1 {
		bufSize = 1
	}
	return &TraceBus{
		subs:    map[chan traceEvent]struct{}{},
		bufSize: bufSize,
	}
}

func (b *TraceBus) Subscribe() chan traceEvent {
	ch := make(chan traceEvent, b.bufSize)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *TraceBus) Unsubscribe(ch chan traceEvent) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

func (b *TraceBus) Emit(ev traceEvent) {
	if ev.TS.IsZero() {
		ev.TS = time.Now().UTC()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		// Non-blocking: drop on slow consumer. SSE clients reconnect.
		select {
		case ch <- ev:
		default:
		}
	}
}

func handleTraceSSE(b *TraceBus) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		ch := b.Subscribe()
		defer b.Unsubscribe(ch)

		for {
			select {
			case ev, ok := <-ch:
				if !ok {
					return
				}
				body, _ := json.Marshal(ev)
				_, _ = w.Write([]byte("data: "))
				_, _ = w.Write(body)
				_, _ = w.Write([]byte("\n\n"))
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	}
}
