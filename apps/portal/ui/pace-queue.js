// pace-queue.js -- single owner of the /trace EventSource. Holds incoming
// events in a FIFO and drains them through subscribers at a configurable
// cadence with per-event-type weights, so the diagram animates over a
// presenter-friendly window instead of flashing through every event in
// the time the backend takes to resolve.

// Stage weights: multiplier on the base pace unit per event type.
// JWT-SVID issuance is the climax (longest dwell); mTLS setup is brief.
const STAGE_WEIGHTS = {
  'portal.resolve.requested': 1.0,
  'mtls.handshake.start':     0.7,
  'mtls.handshake.ok':        1.0,
  'jwt_svid.issued':          2.0,
  'sm.authn_jwt.ok':          1.5,
  'sm.secret_fetched.ok':     1.0,
};

const subscribers = new Set();
const stateSubs   = new Set();
const queue = [];

let currentPace = 0;       // ms base; 0 == real-time
let pendingTimer = null;   // active setTimeout id, or null when idle / mid-fanout
let walking = false;       // true while a resolve walk is in flight
let skipMode = false;      // true while SKIP is collapsing the current walk

function fanout(ev) {
  for (const fn of subscribers) {
    try { fn(ev); }
    catch (e) { console.error('pace-queue subscriber failed:', e); }
  }
}

function setWalking(next) {
  if (walking === next) return;
  walking = next;
  for (const fn of stateSubs) {
    try { fn(next ? 'walking' : 'idle'); }
    catch (e) { console.error('pace-queue stateSub failed:', e); }
  }
}

function drain() {
  pendingTimer = null;
  if (queue.length === 0) {
    skipMode = false;
    setWalking(false);
    return;
  }
  const ev = queue.shift();
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
  // fanout, regardless of whether the queue currently has more items. Events
  // arriving from SSE during this window get queued and drained on the tick.
  // If the queue is still empty when the timer fires, drain() flips to idle.
  const weight = STAGE_WEIGHTS[queue[0]?.type] ?? 1.0;
  pendingTimer = setTimeout(drain, pace * weight);
}

function kick() {
  if (pendingTimer !== null) return;
  // First drain after idle: fire immediately, then schedule next.
  setWalking(true);
  drain();
}

function isErr(type) {
  return typeof type === 'string' && /\.err$|\.error$|\.empty$/.test(type);
}

function preemptAndFlush() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  queue.length = 0;
}

function push(rawEv) {
  // Unwrap carrier-side events that were forwarded as carrier.event.raw.
  let ev = rawEv;
  if (ev?.type === 'carrier.event.raw' && ev.payload?.frame) {
    try { ev = JSON.parse(ev.payload.frame); } catch { /* keep raw */ }
  }
  if (!ev || typeof ev.type !== 'string') return;

  // Error preemption: fan out immediately, drop everything else.
  if (isErr(ev.type)) {
    preemptAndFlush();
    fanout(ev);
    setWalking(false);
    return;
  }

  // Replay preemption: a new resolve mid-walk drops the in-flight queue.
  if (ev.type === 'portal.resolve.requested' && walking) {
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

export function subscribe(handler) {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

export function onStateChange(handler) {
  stateSubs.add(handler);
  return () => stateSubs.delete(handler);
}

export function setPace(value) {
  // Accepts numeric ms or one of off/fast/medium/slow.
  if (typeof value === 'number') {
    currentPace = Math.max(0, value);
  } else if (value === 'off') {
    currentPace = 0;
  } else if (value === 'fast') {
    currentPace = 150;
  } else if (value === 'medium') {
    currentPace = 300;
  } else if (value === 'slow') {
    currentPace = 600;
  } else {
    const n = Number(value);
    currentPace = Number.isFinite(n) && n >= 0 ? n : 0;
  }
}

export function getPace() {
  return currentPace;
}

export function skip() {
  if (!walking) return;
  skipMode = true;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  drain();
}

// === auto-init: open the SSE source ===
// Single EventSource for the entire app; both diagram.js and evidence.js
// subscribe via subscribe() above.
const es = new EventSource('/trace');
es.onmessage = (msg) => {
  let parsed;
  try { parsed = JSON.parse(msg.data); }
  catch { return; }
  push(parsed);
};
