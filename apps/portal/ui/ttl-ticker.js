// One shared 1Hz timer that drives the live TTL countdown in both the
// right-pane diagram and the left-pane evidence card. Decoupled so neither
// consumer can drift relative to the other.

const subs = new Set();
let expEpoch = null;   // unix seconds, set on every jwt_svid.issued
let iatEpoch = null;   // unix seconds, set on every jwt_svid.issued
let timer = null;

function tick() {
  if (expEpoch == null) return;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, expEpoch - now);
  const total = Math.max(1, expEpoch - iatEpoch);
  const fraction = remaining / total;
  for (const fn of subs) {
    try { fn({ remaining, fraction, expEpoch, iatEpoch }); }
    catch (e) { console.error('ttl-ticker subscriber failed:', e); }
  }
}

export function setIssuedAndExp(iat, exp) {
  iatEpoch = iat;
  expEpoch = exp;
  if (!timer) timer = setInterval(tick, 1000);
  tick();
}

export function freeze() {
  // Called when a new resolve starts: hold the last-known values until the
  // next jwt_svid.issued. Subscribers see remaining=0, fraction=0.
  expEpoch = Math.floor(Date.now() / 1000);
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// formatMSS renders a positive integer seconds value as "Xm YYs".
export function formatMSS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}
