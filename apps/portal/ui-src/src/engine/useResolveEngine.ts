// useResolveEngine.ts -- React adapter over the pace-queue and ttl-ticker
// TS ports. Two parallel signals drive the state machine:
//   1. The /resolve HTTP response determines done/error + carries manifest data.
//   2. SSE events via pace-queue drive the animated stage progression.
// This mirrors the vanilla portal.js architecture where fetch() populates
// the manifest pane and pace-queue drives the diagram independently.

import { useState, useEffect, useCallback, useRef } from "react";
import * as paceQueue from "./paceQueue";
import * as ttlTicker from "./ttlTicker";
import { eventToStage, stageVerb as getStageVerb, isErrorEvent } from "./stageMap";
import type { PaceEvent } from "./paceQueue";

export type EngineStatus = "idle" | "running" | "done" | "error";

export interface ResolveResult {
  /** Fields from the carrier's /resolve response body. */
  shipment_id?: string;
  origin?: string;
  destination?: string;
  eta?: string;
  carrier_name?: string;
  weight?: string;
  mode?: string;
  container?: string;
  [key: string]: unknown;
}

export interface ResolveEngine {
  status: EngineStatus;
  stage: number;
  stageVerb: string;
  completed: number;
  jwtTtl: number;
  jwtFraction: number;
  /** The real carrier response body, populated on done. */
  result: ResolveResult | null;
  /** Error detail, populated on error. */
  error: ResolveError | null;
  run: (carrier: "internal" | "external", shipmentId: string) => void;
  reset: () => void;
}

export interface ResolveError {
  type: string;
  message?: string;
  payload?: Record<string, unknown>;
}

/** Connect a single EventSource to /trace. Shared across the app lifetime. */
let es: EventSource | null = null;
function ensureEventSource(): void {
  if (es) return;
  es = new EventSource("/trace");
  es.onmessage = (msg) => {
    let parsed: PaceEvent;
    try {
      parsed = JSON.parse(msg.data as string) as PaceEvent;
    } catch {
      return;
    }
    paceQueue.push(parsed);
  };
}

export function useResolveEngine(): ResolveEngine {
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [stage, setStage] = useState(-1);
  const [completed, setCompleted] = useState(0);
  const [jwtTtl, setJwtTtl] = useState(0);
  const [jwtFraction, setJwtFraction] = useState(0);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<ResolveError | null>(null);
  // Track the highest completed stage so we never go backward.
  const maxStage = useRef(-1);
  // Capture the foreign peer URI from mtls.peer_uri_seen so we can merge
  // it into the error payload when mtls.handshake.err arrives (the backend
  // emits these as two separate SSE events).
  const peerUri = useRef<string | null>(null);
  // Mirror of status, accessible from the pace-queue subscriber closure
  // (which was registered once with [] deps and would otherwise see the
  // initial render's value forever).
  const statusRef = useRef<EngineStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Open the SSE connection once.
  useEffect(() => {
    ensureEventSource();
  }, []);

  // Subscribe to pace-queue events to advance the stage indicator.
  // These drive the visual progression (stage verb, completed count)
  // independently of the HTTP response.
  useEffect(() => {
    const unsub = paceQueue.subscribe((ev: PaceEvent) => {
      const idx = eventToStage(ev.type);

      // Capture the foreign peer URI from mtls.peer_uri_seen. The backend
      // emits this as a separate event before mtls.handshake.err.
      if (ev.type === "mtls.peer_uri_seen" && ev.payload) {
        peerUri.current = (ev.payload as Record<string, unknown>).uri as string ?? null;
      }

      // Error SSE events (e.g. mtls.handshake.err) set error status.
      // These are authoritative for the error path since the Go handler
      // may have already returned 502 by this point. Merge the captured
      // peer URI from mtls.peer_uri_seen into the error payload.
      if (isErrorEvent(ev.type)) {
        const merged: Record<string, unknown> = {
          ...(ev.payload as Record<string, unknown> | undefined),
        };
        if (peerUri.current) {
          merged.uri = peerUri.current;
        }
        setError({
          type: ev.type,
          message: merged.err as string | undefined,
          payload: merged,
        });
        setStage(-1);
        setStatus("error");
        return;
      }

      // JWT TTL: extract iat+exp from jwt_svid.issued
      if (ev.type === "jwt_svid.issued" && ev.payload) {
        const iat = ev.payload.iat as number | undefined;
        const exp = ev.payload.exp as number | undefined;
        if (iat != null && exp != null) {
          ttlTicker.setIssuedAndExp(iat, exp);
        }
      }

      // After done/error, the visual state was set authoritatively by the
      // HTTP response or by the error branch above. Late pace-queue drains
      // MUST NOT rewind stage/completed -- otherwise a partial event stream
      // (e.g. carrier /trace unreachable, so stages 2-4 never arrive) leaves
      // the topology stuck on whatever the last late event index was.
      if (statusRef.current !== "running") return;

      if (idx >= 0 && idx > maxStage.current) {
        maxStage.current = idx;
        setStage(idx);
        setCompleted(idx);
      }
    });
    return unsub;
  }, []);

  // Subscribe to pace-queue state changes (walking/idle).
  useEffect(() => {
    const unsub = paceQueue.onStateChange((state) => {
      if (state === "walking") {
        // Only transition to running if we're not already done/error.
        setStatus((prev) => (prev === "done" || prev === "error" ? prev : "running"));
      }
    });
    return unsub;
  }, []);

  // Subscribe to TTL ticker.
  useEffect(() => {
    const unsub = ttlTicker.subscribe(({ remaining, fraction }) => {
      setJwtTtl(remaining);
      setJwtFraction(fraction);
    });
    return unsub;
  }, []);

  const run = useCallback((carrier: "internal" | "external", shipmentId: string) => {
    // Reset state for new resolve.
    setStatus("running");
    setStage(-1);
    setCompleted(0);
    setResult(null);
    setError(null);
    maxStage.current = -1;
    peerUri.current = null;
    ttlTicker.freeze();

    // POST /resolve. The HTTP response carries the manifest data (done)
    // or the error status. SSE events drive stage animations independently.
    fetch("/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier, shipment_id: shipmentId }),
    })
      .then(async (resp) => {
        if (resp.ok) {
          const data = (await resp.json()) as ResolveResult;
          setResult(data);
          setStatus("done");
          setStage(-1);
          setCompleted(6);
        } else {
          // Non-OK HTTP means the carrier call failed. For external carrier
          // this is 502 (trust boundary rejection). The SSE error event
          // (mtls.handshake.err) may arrive before or after this -- either
          // path sets status to error. Use a functional update so we don't
          // clobber a richer SSE-sourced error that already carries payload
          // (e.g. the foreign carrier's SPIFFE URI).
          const text = await resp.text().catch(() => "");
          setError((prev) => {
            if (prev?.payload) return prev;
            return { type: "http.error", message: text || `${resp.status}` };
          });
          setStatus("error");
        }
      })
      .catch((err) => {
        console.error("resolve POST failed:", err);
        setStatus("error");
        setError({ type: "network.error", message: String(err) });
      });
  }, []);

  const reset = useCallback(() => {
    paceQueue.preemptAndFlush();
    ttlTicker.freeze();
    setStatus("idle");
    setStage(-1);
    setCompleted(0);
    setResult(null);
    setError(null);
    maxStage.current = -1;
    peerUri.current = null;
  }, []);

  return {
    status,
    stage,
    stageVerb: getStageVerb(stage),
    completed,
    jwtTtl,
    jwtFraction,
    result,
    error,
    run,
    reset,
  };
}
