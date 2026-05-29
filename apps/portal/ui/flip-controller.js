// flip-controller.js -- single owner of "which card is flipped" + event
// payload cache for the card backs. Spec docs/superpowers/specs/
// 2026-05-29-flip-card-detail-view-design.md §5 (state model) and §6.3
// (cache contract). Mounted in diagram.js (Task 9).
//
// Architectural contract:
//   - At most ONE card may be flipped at a time. flipTo(id) handles the
//     transition; subscribers are notified with (prev, next) on every change.
//   - The event-payload cache is hydrated from the pace-queue stream so card
//     backs render zero-latency from the most recent payload of each type.
//   - portal.resolve.requested both clears the (non-identity) cache and
//     unflips any currently-open card. §7.3 of the spec: a new walk implies
//     the stale back content for the prior walk would lie about the next.
//   - The /identity fetch is one-shot on module load -- it's the source of
//     truth for the two X.509 card backs and changes only on cert rotation.

import { subscribe } from './pace-queue.js';

const cache = {
  identity: null,
  'jwt_svid.issued':       null,
  'sm.authn_jwt.ok':       null,
  'sm.secret_fetched.ok':  null,
  'mtls.handshake.err':    null,
  'jwt_svid.error':        null,
  'sm.authn_jwt.err':      null,
  'sm.secret_fetched.err': null,
};

let currentFlipped = null;     // card id (e.g., 'jwt-rect') or null
const flipSubs = new Set();    // notified on flip change (renderers)

// Hydrate the cache from the pace-queue stream. Also clear non-identity
// cache + unflip on a new resolve, per spec §7.3.
subscribe((ev) => {
  if (ev.type === 'portal.resolve.requested') {
    for (const k of Object.keys(cache)) {
      if (k !== 'identity') cache[k] = null;
    }
    flipTo(null);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(cache, ev.type)) {
    cache[ev.type] = ev.payload || {};
  }
});

// One-time identity fetch on init (cards know nothing about /identity).
fetch('/identity')
  .then((r) => r.json())
  .then((j) => { cache.identity = j; })
  .catch((e) => console.warn('flip-controller: /identity fetch failed', e));

export function cachedEvent(type) { return cache[type]; }
export function cachedIdentity() { return cache.identity; }

export function flipTo(cardId) {
  if (currentFlipped === cardId) return;
  const prev = currentFlipped;
  currentFlipped = cardId;
  for (const fn of flipSubs) {
    try { fn(prev, cardId); }
    catch (e) { console.error('flip-controller sub failed:', e); }
  }
}

export function currentlyFlipped() { return currentFlipped; }

export function onFlipChange(handler) {
  flipSubs.add(handler);
  return () => flipSubs.delete(handler);
}
