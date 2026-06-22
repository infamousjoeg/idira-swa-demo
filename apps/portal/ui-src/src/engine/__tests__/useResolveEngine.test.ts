// @vitest-environment jsdom
//
// useResolveEngine.test.ts -- regression coverage for the "stuck on
// negotiating mTLS" bug. The engine MUST NOT visually rewind after
// status="done", even when late SSE events drain from the pace queue.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import * as pq from "../paceQueue";
import * as ttl from "../ttlTicker";
import { useResolveEngine } from "../useResolveEngine";

// jsdom has no EventSource. Stub the minimum surface the hook touches:
// `new EventSource(url)` and assigning `.onmessage`. We never push messages
// through the EventSource path in these tests -- we drive pace-queue directly.
class StubEventSource {
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  pq.reset();
  ttl.freeze();
  (globalThis as unknown as { EventSource: typeof StubEventSource }).EventSource =
    StubEventSource;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Build a settled fetch response stub. The engine only calls .ok, .status,
// .json(), .text() -- no Headers, no streaming.
function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

describe("useResolveEngine -- partial-event-stream resilience", () => {
  it(
    "stays at completed=6 / stage=-1 after HTTP done, even when the only " +
      "SSE events received are stage 0-1 plus carrier.trace.unreachable",
    async () => {
      // SLOW pace so the queue cannot drain before the HTTP response lands.
      pq.setPace("slow");

      // Hold the fetch promise open so we control exactly when HTTP "done" fires.
      let resolveFetch: ((r: Response) => void) | null = null;
      const fetchSpy = vi.fn(
        () =>
          new Promise<Response>((res) => {
            resolveFetch = res;
          }),
      );
      (globalThis as unknown as { fetch: typeof fetch }).fetch =
        fetchSpy as unknown as typeof fetch;

      const { result } = renderHook(() => useResolveEngine());

      // Kick the resolve. setStatus("running") + setStage(-1) + setCompleted(0).
      act(() => {
        result.current.run("internal", "SHP-DEBUG");
      });

      // Simulate the exact event subset we observed on the live cluster when
      // the carrier's /trace stream was unreachable: stages 0,1,(no 2/3/4),1.
      act(() => {
        pq.push({ type: "portal.resolve.requested" });
        pq.push({ type: "mtls.handshake.start" });
        pq.push({
          type: "carrier.trace.unreachable",
          payload: { err: "x509: expired" },
        });
        pq.push({ type: "mtls.handshake.ok" });
      });

      // After the immediate kick, only stage 0 has been fanned out. The next
      // drain is scheduled for pace(600) * STAGE_WEIGHTS["mtls.handshake.start"](0.7) = 420ms.
      expect(result.current.stage).toBe(0);
      expect(result.current.completed).toBe(0);

      // HTTP /resolve returns OK -- this is the moment the engine commits to
      // the canonical "all done" visual state: stage=-1, completed=6.
      await act(async () => {
        resolveFetch!(
          okResponse({
            shipment_id: "SHP-DEBUG",
            carrier_name: "Praetor Logistics",
          }),
        );
        // Flush the .then chain on the fetch promise.
        await Promise.resolve();
      });

      expect(result.current.status).toBe("done");
      expect(result.current.stage).toBe(-1);
      expect(result.current.completed).toBe(6);

      // Now drain ALL remaining pace-queue events. With Slow pace the longest
      // post-done drain chain is well under 5s; advance generously.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // THE INVARIANT: the success card already shows "manifest returned" --
      // the topology MUST NOT rewind to "negotiating mTLS" because of late
      // pace-queue events. completed must stay at 6, stage at -1.
      expect(result.current.status).toBe("done");
      expect(result.current.completed).toBe(6);
      expect(result.current.stage).toBe(-1);
    },
  );
});
