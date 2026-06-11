// ttlTicker.ts -- TS port of apps/portal/ui/ttl-ticker.js.
// One shared 1Hz timer that drives the live TTL countdown in both the
// right-pane diagram and the left-pane evidence card. Decoupled so neither
// consumer can drift relative to the other.

export interface TtlSnapshot {
  remaining: number;
  fraction: number;
  expEpoch: number;
  iatEpoch: number;
}

const subs = new Set<(snap: TtlSnapshot) => void>();
let expEpoch: number | null = null;
let iatEpoch: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  if (expEpoch == null || iatEpoch == null) return;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, expEpoch - now);
  const total = Math.max(1, expEpoch - iatEpoch);
  const fraction = remaining / total;
  for (const fn of subs) {
    try {
      fn({ remaining, fraction, expEpoch, iatEpoch });
    } catch (e) {
      console.error("ttl-ticker subscriber failed:", e);
    }
  }
}

export function setIssuedAndExp(iat: number, exp: number): void {
  iatEpoch = iat;
  expEpoch = exp;
  if (!timer) timer = setInterval(tick, 1000);
  tick();
}

/** Called when a new resolve starts: hold the last-known values until the
 *  next jwt_svid.issued. Subscribers see remaining=0, fraction=0. */
export function freeze(): void {
  expEpoch = Math.floor(Date.now() / 1000);
}

export function subscribe(fn: (snap: TtlSnapshot) => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** formatMSS renders a positive integer seconds value as "Xm YYs". */
export function formatMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

/** Reset all internal state. Used by tests and the React adapter. */
export function reset(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  expEpoch = null;
  iatEpoch = null;
  subs.clear();
}
