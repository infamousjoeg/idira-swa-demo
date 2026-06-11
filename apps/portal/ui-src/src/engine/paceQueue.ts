// paceQueue.ts -- TS port of apps/portal/ui/pace-queue.js.
// Identical public API and runtime behavior. The M7 ordering invariant
// (mtls.peer_uri_seen MUST land before mtls.handshake.err regardless of
// pace) is load-bearing and tested explicitly.

export interface PaceEvent {
  type: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export type PaceState = "walking" | "idle";
export type PaceKey = "off" | "fast" | "medium" | "slow";

// Stage weights: multiplier on the base pace unit per event type.
// JWT-SVID issuance is the climax (longest dwell); mTLS setup is brief.
export const STAGE_WEIGHTS: Record<string, number> = {
  "portal.resolve.requested": 1.0,
  "mtls.handshake.start": 0.7,
  "mtls.handshake.ok": 1.0,
  "jwt_svid.issued": 2.0,
  "sm.authn_jwt.ok": 1.5,
  "sm.secret_fetched.ok": 1.0,
};

const subscribers = new Set<(ev: PaceEvent) => void>();
const stateSubs = new Set<(state: PaceState) => void>();
const queue: PaceEvent[] = [];

let currentPace = 0; // ms base; 0 == real-time
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let walking = false; // true while a resolve walk is in flight
let skipMode = false; // true while SKIP is collapsing the current walk

function fanout(ev: PaceEvent): void {
  for (const fn of subscribers) {
    try {
      fn(ev);
    } catch (e) {
      console.error("pace-queue subscriber failed:", e);
    }
  }
}

function setWalking(next: boolean): void {
  if (walking === next) return;
  walking = next;
  for (const fn of stateSubs) {
    try {
      fn(next ? "walking" : "idle");
    } catch (e) {
      console.error("pace-queue stateSub failed:", e);
    }
  }
}

function drain(): void {
  pendingTimer = null;
  if (queue.length === 0) {
    skipMode = false;
    setWalking(false);
    return;
  }
  const ev = queue.shift()!;
  fanout(ev);
  const pace = skipMode ? 0 : currentPace;
  if (pace === 0) {
    // Real-time path: drain everything synchronously, then idle.
    if (queue.length === 0) {
      skipMode = false;
      setWalking(false);
      return;
    }
    drain();
    return;
  }
  // Paced path: hold "walking" state for at least pace*weight ms after each
  // fanout, regardless of whether the queue currently has more items.
  const weight = STAGE_WEIGHTS[queue[0]?.type ?? ""] ?? 1.0;
  pendingTimer = setTimeout(drain, pace * weight);
}

function kick(): void {
  if (pendingTimer !== null) return;
  // First drain after idle: fire immediately, then schedule next.
  setWalking(true);
  drain();
}

function isErr(type: string): boolean {
  return typeof type === "string" && /\.err$|\.error$|\.empty$/.test(type);
}

/** Clear any pending timer and empty the queue. */
export function preemptAndFlush(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  queue.length = 0;
}

/** Push an event into the pace queue. Handles unwrapping, error preemption,
 *  and replay preemption identically to the vanilla JS original. */
export function push(rawEv: PaceEvent): void {
  // Unwrap carrier-side events that were forwarded as carrier.event.raw.
  let ev = rawEv;
  if (
    ev?.type === "carrier.event.raw" &&
    (ev.payload as Record<string, unknown> | undefined)?.frame
  ) {
    try {
      ev = JSON.parse(
        String((ev.payload as Record<string, unknown>).frame),
      ) as PaceEvent;
    } catch {
      /* keep raw */
    }
  }
  if (!ev || typeof ev.type !== "string") return;

  // Error preemption: drain any queued non-error events synchronously FIRST
  // so load-bearing state mutations (e.g. M7's mtls.peer_uri_seen, which
  // primes the foreign-TD treatment that mtls.handshake.err keys off of)
  // land on subscribers before the error itself. Then fan out the error
  // and stop walking.
  if (isErr(ev.type)) {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    while (queue.length > 0) {
      fanout(queue.shift()!);
    }
    fanout(ev);
    setWalking(false);
    return;
  }

  // Replay preemption: a new resolve mid-walk drops the in-flight queue.
  if (ev.type === "portal.resolve.requested" && walking) {
    preemptAndFlush();
    queue.push(ev);
    // Force a fresh kick (the previous walk's setWalking(false) is short-circuited
    // because we immediately set it back to true).
    drain();
    pendingTimer = null;
    setWalking(true);
    return;
  }

  queue.push(ev);
  kick();
}

// === public API ===

export function subscribe(handler: (ev: PaceEvent) => void): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

export function onStateChange(handler: (state: PaceState) => void): () => void {
  stateSubs.add(handler);
  return () => {
    stateSubs.delete(handler);
  };
}

export function setPace(value: PaceKey | number | string): void {
  if (typeof value === "number") {
    currentPace = Math.max(0, value);
  } else if (value === "off") {
    currentPace = 0;
  } else if (value === "fast") {
    currentPace = 150;
  } else if (value === "medium") {
    currentPace = 300;
  } else if (value === "slow") {
    currentPace = 600;
  } else {
    const n = Number(value);
    currentPace = Number.isFinite(n) && n >= 0 ? n : 0;
  }
}

export function getPace(): number {
  return currentPace;
}

export function skip(): void {
  if (!walking) return;
  skipMode = true;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  drain();
}

/** Reset all internal state. Used by tests and the React adapter. */
export function reset(): void {
  preemptAndFlush();
  walking = false;
  skipMode = false;
  subscribers.clear();
  stateSubs.clear();
}
