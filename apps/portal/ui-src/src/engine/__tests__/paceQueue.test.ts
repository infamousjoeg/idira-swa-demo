// paceQueue.test.ts -- behavioral tests for the pace-queue TS port.
// Covers: pace value mapping, per-event weight table, M7 ordering
// invariant, and replay preemption. These are the contracts the
// vanilla pace-queue.js implicitly enforces.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as pq from "../paceQueue";
import { STAGE_WEIGHTS } from "../paceQueue";

beforeEach(() => {
  vi.useFakeTimers();
  pq.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Pace value mapping: off=0, fast=150, medium=300, slow=600
// ---------------------------------------------------------------------------
describe("pace value mapping", () => {
  it("off -> 0ms", () => {
    pq.setPace("off");
    expect(pq.getPace()).toBe(0);
  });
  it("fast -> 150ms", () => {
    pq.setPace("fast");
    expect(pq.getPace()).toBe(150);
  });
  it("medium -> 300ms", () => {
    pq.setPace("medium");
    expect(pq.getPace()).toBe(300);
  });
  it("slow -> 600ms", () => {
    pq.setPace("slow");
    expect(pq.getPace()).toBe(600);
  });
  it("numeric value is accepted directly", () => {
    pq.setPace(450);
    expect(pq.getPace()).toBe(450);
  });
  it("negative numeric clamped to 0", () => {
    pq.setPace(-100);
    expect(pq.getPace()).toBe(0);
  });
  it("invalid string falls back to 0", () => {
    pq.setPace("bogus");
    expect(pq.getPace()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// STAGE_WEIGHTS table
// ---------------------------------------------------------------------------
describe("per-event weight table", () => {
  it("portal.resolve.requested = 1.0", () => {
    expect(STAGE_WEIGHTS["portal.resolve.requested"]).toBe(1.0);
  });
  it("mtls.handshake.start = 0.7", () => {
    expect(STAGE_WEIGHTS["mtls.handshake.start"]).toBe(0.7);
  });
  it("mtls.handshake.ok = 1.0", () => {
    expect(STAGE_WEIGHTS["mtls.handshake.ok"]).toBe(1.0);
  });
  it("jwt_svid.issued = 2.0 (climax, longest dwell)", () => {
    expect(STAGE_WEIGHTS["jwt_svid.issued"]).toBe(2.0);
  });
  it("sm.authn_jwt.ok = 1.5", () => {
    expect(STAGE_WEIGHTS["sm.authn_jwt.ok"]).toBe(1.5);
  });
  it("sm.secret_fetched.ok = 1.0", () => {
    expect(STAGE_WEIGHTS["sm.secret_fetched.ok"]).toBe(1.0);
  });
  it("unknown event type defaults to 1.0 weight (via fallback)", () => {
    // The default is applied in the drain function, not in the table.
    // Verify the table does not contain a wildcard.
    expect(STAGE_WEIGHTS["some.unknown.event"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M7 ordering invariant: mtls.peer_uri_seen MUST land before
// mtls.handshake.err regardless of pace value.
// ---------------------------------------------------------------------------
describe("M7 ordering invariant", () => {
  it.each(["off", "fast", "medium", "slow"] as const)(
    "peer_uri_seen fires before handshake.err at pace=%s",
    (pace) => {
      pq.setPace(pace);
      const received: string[] = [];
      pq.subscribe((ev) => received.push(ev.type));

      // Simulate the M7 sequence: peer_uri_seen queued, then error arrives.
      pq.push({ type: "portal.resolve.requested" });
      // Advance timers to let the first event drain.
      vi.advanceTimersByTime(1000);

      pq.push({ type: "mtls.handshake.start" });
      vi.advanceTimersByTime(1000);

      // peer_uri_seen is queued while the walk is paced.
      pq.push({ type: "mtls.peer_uri_seen" });
      // Error arrives: must drain the queued peer_uri_seen FIRST.
      pq.push({ type: "mtls.handshake.err" });

      // Advance to let any remaining timers fire.
      vi.advanceTimersByTime(5000);

      const peerIdx = received.indexOf("mtls.peer_uri_seen");
      const errIdx = received.indexOf("mtls.handshake.err");

      expect(peerIdx).toBeGreaterThanOrEqual(0);
      expect(errIdx).toBeGreaterThan(peerIdx);
    },
  );
});

// ---------------------------------------------------------------------------
// Replay preemption: a new portal.resolve.requested mid-walk drops
// the in-flight queue and starts a new walk.
// ---------------------------------------------------------------------------
describe("replay preemption", () => {
  it("drops in-flight queue on new resolve request", () => {
    pq.setPace("medium");
    const received: string[] = [];
    pq.subscribe((ev) => received.push(ev.type));

    // Start a walk.
    pq.push({ type: "portal.resolve.requested" });
    vi.advanceTimersByTime(500);

    // Queue more events.
    pq.push({ type: "mtls.handshake.start" });
    pq.push({ type: "mtls.handshake.ok" });

    // Mid-walk: new resolve request should drop queued events.
    pq.push({ type: "portal.resolve.requested" });
    vi.advanceTimersByTime(5000);

    // The second resolve.requested should be present; the queued
    // mtls.handshake.start and mtls.handshake.ok from the first walk
    // may or may not have drained before preemption (depends on timing),
    // but the second portal.resolve.requested must be present.
    const resolveCount = received.filter(
      (t) => t === "portal.resolve.requested",
    ).length;
    expect(resolveCount).toBe(2);

    // After the second resolve.requested, no events from the first
    // walk's queue should appear (the ones queued after handshake.start
    // that hadn't drained yet).
    const secondResolveIdx = received.lastIndexOf(
      "portal.resolve.requested",
    );
    const afterSecondResolve = received.slice(secondResolveIdx + 1);
    // The only events after the second resolve.requested should be from
    // a fresh walk, not leftovers from the first.
    expect(
      afterSecondResolve.every(
        (t) =>
          t !== "mtls.handshake.start" && t !== "mtls.handshake.ok",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State transitions: walking/idle
// ---------------------------------------------------------------------------
describe("state transitions", () => {
  it("transitions to walking on push, back to idle when queue drains", () => {
    pq.setPace("off");
    const states: string[] = [];
    pq.onStateChange((s) => states.push(s));

    pq.push({ type: "portal.resolve.requested" });
    vi.advanceTimersByTime(100);

    expect(states).toContain("walking");
    expect(states[states.length - 1]).toBe("idle");
  });

  it("stays walking during paced drain", () => {
    pq.setPace("medium");
    const states: string[] = [];
    pq.onStateChange((s) => states.push(s));

    pq.push({ type: "portal.resolve.requested" });
    pq.push({ type: "mtls.handshake.start" });

    // Should be walking.
    expect(states).toContain("walking");

    // Advance past first event but not second.
    vi.advanceTimersByTime(250);
    expect(states[states.length - 1]).toBe("walking");

    // Drain everything.
    vi.advanceTimersByTime(5000);
    expect(states[states.length - 1]).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// SKIP mode
// ---------------------------------------------------------------------------
describe("skip mode", () => {
  it("collapses current walk to 0ms while preserving event ordering", () => {
    pq.setPace("slow");
    const received: string[] = [];
    pq.subscribe((ev) => received.push(ev.type));

    pq.push({ type: "portal.resolve.requested" });
    pq.push({ type: "mtls.handshake.start" });
    pq.push({ type: "mtls.handshake.ok" });

    // Let first event drain.
    vi.advanceTimersByTime(100);

    pq.skip();
    vi.advanceTimersByTime(100);

    // All events should have drained in order despite slow pace.
    expect(received).toEqual([
      "portal.resolve.requested",
      "mtls.handshake.start",
      "mtls.handshake.ok",
    ]);
  });
});

// ---------------------------------------------------------------------------
// carrier.event.raw unwrapping
// ---------------------------------------------------------------------------
describe("carrier.event.raw unwrapping", () => {
  it("unwraps a carrier.event.raw wrapper to the inner event", () => {
    pq.setPace("off");
    const received: string[] = [];
    pq.subscribe((ev) => received.push(ev.type));

    pq.push({
      type: "carrier.event.raw",
      payload: { frame: JSON.stringify({ type: "sm.authn_jwt.ok" }) },
    });
    vi.advanceTimersByTime(100);

    expect(received).toContain("sm.authn_jwt.ok");
  });
});
