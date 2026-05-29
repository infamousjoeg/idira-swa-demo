// card-backs.js -- per-card-type back-content renderers. Returns HTML
// strings; diagram.js injects them into each card's <foreignObject> child
// div via innerHTML. Spec docs/superpowers/specs/2026-05-29-flip-card-detail-
// view-design.md §6.1 (back content) and §7.4 (visual style).
//
// Conventions:
//   - All dynamic text MUST go through escapeHTML(). The JSON formatter
//     handles escaping internally so its output is safe to interpolate.
//   - Err-state renderers (per spec §8.1) are selected by inspecting cached
//     error payloads alongside the happy-path payload; if an err payload is
//     present and more recent (or the happy-path is absent), the err view
//     wins.
//   - Empty-cache fallback (per spec §8.2) renders a minimal "no data"
//     eyebrow so the back never appears blank.

import { cachedEvent, cachedIdentity } from './flip-controller.js';

function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function row(k, v) {
  return `<div class="card-back__row"><div class="card-back__k">${escapeHTML(k)}</div><div class="card-back__v">${escapeHTML(v == null ? '' : v)}</div></div>`;
}

// formatJSON -- lightweight syntax coloring for a JSON.stringify output.
// Regex-based class spans; relies on escapeHTML having already neutralized
// any HTML in string values (we do it inline here against the stringified
// JSON). Spec §7.4 (json-key / json-str / json-num / json-punct classes).
function formatJSON(obj) {
  if (obj == null) return '';
  const str = JSON.stringify(obj, null, 2);
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("[a-zA-Z_][\w]*")(\s*:)/g, '<span class="json-key">$1</span>$2')
    .replace(/: ("(?:[^"\\]|\\.)*")/g, ': <span class="json-str">$1</span>')
    .replace(/: (-?\d+(?:\.\d+)?)/g, ': <span class="json-num">$1</span>')
    .replace(/([{}\[\],])/g, '<span class="json-punct">$1</span>');
}

// emptyBack -- spec §8.2 fallback.
function emptyBack(eyebrow) {
  return `<div class="card-back">
    <div class="card-back__eyebrow">${escapeHTML(eyebrow)}</div>
    <div class="card-back__v" style="opacity: 0.7;">(awaiting resolve)</div>
  </div>`;
}

// errBack -- spec §8.1 err-state renderer (shared shape across cards).
function errBack(eyebrow, errPayload, atHint) {
  return `<div class="card-back">
    <div class="card-back__eyebrow">${escapeHTML(eyebrow)}</div>
    ${row('status', 'request rejected')}
    ${row('err', errPayload?.err || '(no detail)')}
    ${row('at', atHint)}
  </div>`;
}

// === renderers ===

export function renderPortalX509Back() {
  const id = cachedIdentity();
  const s = id?.portal_svid;
  if (!s) return emptyBack('PORTAL X.509-SVID');
  return `<div class="card-back">
    <div class="card-back__eyebrow">PORTAL X.509-SVID &middot; CERT DETAIL</div>
    ${row('san uri', s.san_uri)}
    ${row('subject', s.subject_dn || '(empty -- SPIFFE convention)')}
    ${row('issuer', s.issuer_dn)}
    ${row('serial', s.serial)}
    ${row('valid', `${s.not_before || '?'} -- ${s.not_after || '?'}`)}
    ${row('key alg', s.key_alg)}
    ${row('sig alg', s.sig_alg)}
    ${row('sha-256', s.fingerprint_sha256)}
  </div>`;
}

export function renderCarrierX509Back() {
  const id = cachedIdentity();
  // mTLS err is the surface failure for the carrier X.509 card.
  const err = cachedEvent('mtls.handshake.err');
  if (err) return errBack('CARRIER X.509-SVID &middot; ERROR', err, 'portal -> carrier mTLS');
  const s = id?.carrier_svid;
  if (!s) return emptyBack('CARRIER X.509-SVID');
  return `<div class="card-back">
    <div class="card-back__eyebrow">CARRIER X.509-SVID &middot; CERT DETAIL</div>
    ${row('san uri', s.san_uri)}
    ${row('subject', s.subject_dn || '(empty -- SPIFFE convention)')}
    ${row('issuer', s.issuer_dn)}
    ${row('serial', s.serial)}
    ${row('valid', `${s.not_before || '?'} -- ${s.not_after || '?'}`)}
    ${row('key alg', s.key_alg)}
    ${row('sig alg', s.sig_alg)}
    ${row('sha-256', s.fingerprint_sha256)}
  </div>`;
}

export function renderJWTSvidBack() {
  const err = cachedEvent('jwt_svid.error');
  if (err) return errBack('JWT-SVID &middot; ERROR', err, 'carrier -> swa-agent');
  const e = cachedEvent('jwt_svid.issued');
  if (!e) return emptyBack('JWT-SVID');
  const claims = {
    sub: e.spiffe_id, aud: e.aud, iss: e.iss,
    iat: e.iat, exp: e.exp, jti: e.jti,
  };
  const header = { alg: e.alg, kid: e.kid, typ: e.typ || 'JWT' };
  const raw = e.raw || '';
  const parts = raw.split('.');
  return `<div class="card-back">
    <div class="card-back__eyebrow">JWT-SVID &middot; DECODED PAYLOAD</div>
    <pre class="card-back__json">${formatJSON(claims)}</pre>
    <div class="card-back__eyebrow" style="margin-top: 10px;">JOSE HEADER</div>
    <pre class="card-back__json">${formatJSON(header)}</pre>
    <div class="card-back__eyebrow" style="margin-top: 10px;">RAW (header.payload.sig)</div>
    <pre class="card-back__json" style="opacity: 0.7;">${escapeHTML(parts[0] || '')}.${escapeHTML(parts[1] || '')}.${escapeHTML(parts[2] || '')}</pre>
  </div>`;
}

export function renderSMTokenBack() {
  const err = cachedEvent('sm.authn_jwt.err');
  if (err) return errBack('SM TOKEN &middot; ERROR', err, 'carrier -> sm.authn_jwt');
  const e = cachedEvent('sm.authn_jwt.ok');
  if (!e) return emptyBack('SM TOKEN GRANTED');
  return `<div class="card-back">
    <div class="card-back__eyebrow">SM TOKEN GRANTED &middot; REQUEST</div>
    ${row('method', e.method)}
    ${row('url', e.url)}
    ${row('body', 'JWT-SVID (shown in the hero card)')}
    <div class="card-back__eyebrow" style="margin-top: 10px;">RESPONSE</div>
    ${row('status', e.status)}
    ${row('bearer', e.token_redacted)}
    ${row('ttl', e.token_ttl_seconds ? `${e.token_ttl_seconds}s` : '(unknown)')}
    ${row('scope', e.scope)}
  </div>`;
}

export function renderSecretReturnedBack() {
  const err = cachedEvent('sm.secret_fetched.err');
  if (err) return errBack('SECRET &middot; ERROR', err, 'carrier -> sm.secrets');
  const e = cachedEvent('sm.secret_fetched.ok');
  if (!e) return emptyBack('SECRET RETURNED');
  return `<div class="card-back">
    <div class="card-back__eyebrow">SECRET RETURNED &middot; REQUEST</div>
    ${row('method', e.method)}
    ${row('url', e.url)}
    ${row('secret id', e.secret_id)}
    <div class="card-back__eyebrow" style="margin-top: 10px;">RESPONSE</div>
    ${row('status', e.status)}
    ${row('bytes', e.bytes)}
    ${row('version', e.version || 'n/a')}
    ${row('scope', e.policy_scope)}
    <div style="margin-top: 10px; font-style: italic; opacity: 0.7;">secret value never displayed</div>
  </div>`;
}

// Dispatch by card id used in diagram.js.
const RENDERERS = {
  'portal-rect':  renderPortalX509Back,
  'carrier-rect': renderCarrierX509Back,
  'jwt-rect':     renderJWTSvidBack,
  'sm-rect':      renderSMTokenBack,
  'secret-rect':  renderSecretReturnedBack,
};

export function renderBack(cardId) {
  const fn = RENDERERS[cardId];
  return fn ? fn() : '';
}

// Exported for tests + accidental upstream use; keep escapeHTML internal
// to the module's contract so future renderers stay disciplined.
export { escapeHTML };
