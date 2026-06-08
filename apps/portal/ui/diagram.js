// diagram.js -- live SPIFFE trust diagram. Replaces inspector.js.
//
// Lifecycle:
//   1. On import, render the SVG skeleton into #diagram (all stages in idle state).
//   2. fetch('/identity') and populate hierarchy ribbon + workload SAN URIs.
//   3. (Task 10) Subscribe to /trace SSE and mutate SVG classes on each event.
//   4. (Task 11) Subscribe to the TTL ticker to update the JWT-SVID hero countdown.

import { setIssuedAndExp, subscribe as subscribeTTL, formatMSS } from './ttl-ticker.js';
import { subscribe as subscribeTrace, onStateChange, skip as skipPace } from './pace-queue.js';
import { flipTo, currentlyFlipped, onFlipChange } from './flip-controller.js';
import { renderBack, setForeignCertState, clearForeignCertState } from './card-backs.js';
import { renderRejection } from './evidence.js';

const root = document.getElementById('diagram');
if (root) renderSkeleton(root);

let identityCache = null;

// resetDiagram clears all per-resolve M7 foreign-TD mutations and restores
// the bootstrap presentation. Called by portal.js when the carrier selector
// toggles. Also calls resetForReplay() to wipe any prior stage state so the
// next resolve walks the SSE timeline from idle. Idempotent.
export function resetDiagram() {
  // Remove the TRUST BOUNDARY tile if present.
  const tile = document.getElementById('tile-boundary');
  if (tile) tile.remove();

  // Restore the right card's label + foreign-TD treatment.
  const carrierRect = document.getElementById('carrier-rect');
  const carrierLbl  = document.getElementById('carrier-rect-label');
  if (carrierRect) carrierRect.classList.remove('foreign');
  if (carrierLbl) {
    carrierLbl.classList.remove('label-foreign');
    carrierLbl.textContent = 'CARRIER · X.509-SVID';
  }
  const san1 = document.getElementById('carrier-san-1');
  const san2 = document.getElementById('carrier-san-2');
  if (san1) san1.classList.remove('uri-foreign');
  if (san2) san2.classList.remove('uri-foreign');

  // Undim any stages skipped by the foreign-rejection path.
  document.querySelectorAll('.stage-skipped').forEach(el => el.classList.remove('stage-skipped'));

  // Reset the mTLS connector + label (label doubles as the M7 "eyebrow"
  // because the existing #mtls-label is the only text element above the line).
  const conn = document.getElementById('mtls-line');
  if (conn) conn.classList.remove('rejected');
  const eyebrow = document.getElementById('mtls-label');
  if (eyebrow) {
    eyebrow.classList.remove('eyebrow-rejected');
    eyebrow.textContent = 'mTLS';
  }

  // Drop the cached foreign cert details so the carrier card-back flips back
  // to the internal X.509 view.
  clearForeignCertState();

  // Walk the existing replay-reset so stage cards return to idle and identity
  // re-paints. paintIdentity restores the internal carrier SAN URI.
  resetForReplay();
  if (identityCache) paintIdentity(identityCache);
}

async function loadIdentity() {
  try {
    const resp = await fetch('/identity', { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`/identity ${resp.status}`);
    identityCache = await resp.json();
    paintIdentity(identityCache);
  } catch (err) {
    console.error('diagram: /identity failed:', err);
    paintIdentityUnavailable();
  }
  // Branch connectors below the hierarchy ribbon are always "lit" -- they
  // represent static infrastructure relationships, not in-flight requests.
  ['branch-stem', 'branch-cross', 'branch-l', 'branch-r'].forEach(id => setConnState(id, 'lit'));
}

function renderSkeleton(host) {
  // Coordinates pulled directly from the diagram design. Keep this SVG
  // hand-authored -- no string templating, no D3 -- so the structure is
  // greppable when something looks wrong.
  host.innerHTML = `
<svg viewBox="0 0 580 720" xmlns="http://www.w3.org/2000/svg" aria-label="SPIFFE trust diagram">
  <defs>
    <marker id="ar"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" class="conn-arrow"/></marker>
    <marker id="arl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" class="conn-arrow"/></marker>
    <marker id="arr" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="conn-arrow"/></marker>
  </defs>

  <!-- Hierarchy ribbon: always lit, populated from /identity -->
  <g id="hierarchy">
    <rect x="10" y="6"  width="560" height="30" fill="none" stroke="#173EB8"/>
    <text x="22" y="24" font-family="Helvetica Neue" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira">TRUST DOMAIN</text>
    <text x="200" y="25" font-family="ui-monospace,Menlo" font-size="12" fill="#FFFFFF" id="td-val">—</text>
    <line x1="190" y1="6" x2="190" y2="36" stroke="#173EB8"/>

    <rect x="10" y="36" width="560" height="30" fill="none" stroke="#173EB8"/>
    <text x="22" y="55" font-family="Helvetica Neue" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira">SERVER GROUP</text>
    <text x="200" y="55" font-family="ui-monospace,Menlo" font-size="12" fill="#FFFFFF" id="sg-val">—</text>
    <text x="290" y="55" font-family="Helvetica Neue" font-size="10" class="label-mute">attestor:</text>
    <text x="340" y="55" font-family="ui-monospace,Menlo" font-size="11" class="label-idira" id="attestor-val">—</text>
    <line x1="190" y1="36" x2="190" y2="66" stroke="#173EB8"/>

    <rect x="10" y="66" width="560" height="30" fill="none" stroke="#173EB8"/>
    <text x="22" y="85" font-family="Helvetica Neue" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira">NODE GROUP</text>
    <text x="200" y="85" font-family="ui-monospace,Menlo" font-size="12" fill="#FFFFFF" id="ng-val">—</text>
  </g>

  <!-- Branch connector -->
  <line x1="290" y1="96"  x2="290" y2="120" class="conn" id="branch-stem"/>
  <line x1="130" y1="120" x2="450" y2="120" class="conn" id="branch-cross"/>
  <line x1="130" y1="120" x2="130" y2="140" class="conn" id="branch-l" marker-end="url(#ar)"/>
  <line x1="450" y1="120" x2="450" y2="140" class="conn" id="branch-r" marker-end="url(#ar)"/>

  <!-- Portal X.509-SVID card -->
  <g id="portal-rect-host" class="card-host">
    <rect x="10" y="140" width="250" height="130" class="stage-rect" id="portal-rect"/>
    <text x="22" y="160" font-size="9" font-weight="700" letter-spacing="2" class="label-idira">PORTAL · X.509-SVID</text>
    <text x="22" y="180" font-size="8" font-weight="700" letter-spacing="1.6" class="label-mute">SAN URI</text>
    <text x="22" y="195" font-family="ui-monospace,Menlo" font-size="10" class="label-idira" id="portal-san-1">—</text>
    <text x="22" y="208" font-family="ui-monospace,Menlo" font-size="10" class="label-idira" id="portal-san-2"></text>
    <text x="22" y="234" font-size="8" font-weight="700" letter-spacing="1.6" class="label-mute" id="portal-valid-label">VALID</text>
    <text x="64" y="234" font-family="ui-monospace,Menlo" font-size="11" fill="#FFFFFF" id="portal-valid-val">—</text>
    <rect x="22" y="240" width="226" height="4" fill="#16317a"/>
    <rect x="22" y="240" width="0"   height="4" fill="#265BFF" id="portal-valid-bar"/>
    <text x="22" y="262" font-size="8" class="label-idira" id="portal-rotation">—</text>
    <foreignObject id="portal-rect-back-fo" x="10" y="140" width="250" height="130" visibility="hidden">
      <div xmlns="http://www.w3.org/1999/xhtml" class="card-back-host" id="portal-rect-back-host"></div>
    </foreignObject>
    <g class="card-caret" id="portal-rect-caret" visibility="hidden">
      <path d="M236,148 L246,148 L246,158" stroke="var(--idira-250)" stroke-width="1" fill="none"/>
    </g>
  </g>

  <!-- Carrier X.509-SVID card -->
  <g id="carrier-rect-host" class="card-host">
    <rect x="320" y="140" width="250" height="130" class="stage-rect" id="carrier-rect"/>
    <text x="332" y="160" font-size="9" font-weight="700" letter-spacing="2" class="label-idira" id="carrier-rect-label">CARRIER · X.509-SVID</text>
    <text x="332" y="180" font-size="8" font-weight="700" letter-spacing="1.6" class="label-mute">SAN URI</text>
    <text x="332" y="195" font-family="ui-monospace,Menlo" font-size="10" class="label-idira" id="carrier-san-1">—</text>
    <text x="332" y="208" font-family="ui-monospace,Menlo" font-size="10" class="label-idira" id="carrier-san-2"></text>
    <text x="332" y="234" font-size="8" font-weight="700" letter-spacing="1.6" class="label-mute" id="carrier-valid-label">VALID</text>
    <text x="374" y="234" font-family="ui-monospace,Menlo" font-size="11" fill="#FFFFFF" id="carrier-valid-val">—</text>
    <rect x="332" y="240" width="226" height="4" fill="#16317a"/>
    <rect x="332" y="240" width="0"   height="4" fill="#265BFF" id="carrier-valid-bar"/>
    <text x="332" y="262" font-size="8" class="label-idira" id="carrier-rotation">—</text>
    <foreignObject id="carrier-rect-back-fo" x="320" y="140" width="250" height="130" visibility="hidden">
      <div xmlns="http://www.w3.org/1999/xhtml" class="card-back-host" id="carrier-rect-back-host"></div>
    </foreignObject>
    <g class="card-caret" id="carrier-rect-caret" visibility="hidden">
      <path d="M546,148 L556,148 L556,158" stroke="var(--idira-250)" stroke-width="1" fill="none"/>
    </g>
  </g>

  <!-- mTLS edge -->
  <g id="mtls-edge">
    <line x1="260" y1="205" x2="320" y2="205" class="conn" id="mtls-line" marker-start="url(#arl)" marker-end="url(#arr)"/>
    <text x="290" y="192" font-size="9" font-weight="700" letter-spacing="1.6" text-anchor="middle" class="label-mute" id="mtls-label">mTLS</text>
    <text x="290" y="224" font-family="ui-monospace,Menlo" font-size="8" text-anchor="middle" class="label-idira" id="mtls-cipher"></text>
  </g>

  <!-- Connector to JWT hero -->
  <line x1="450" y1="270" x2="450" y2="304" class="conn" id="to-jwt" marker-end="url(#ar)"/>
  <text x="458" y="288" font-size="9" class="label-mute" id="to-jwt-label">workload-API issues</text>

  <!-- JWT-SVID hero -->
  <g id="jwt-rect-host" class="card-host">
    <rect x="100" y="304" width="470" height="180" class="stage-rect" id="jwt-rect"/>
    <text x="116" y="328" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira" id="jwt-header">CARRIER · JWT-SVID</text>
    <text x="116" y="402" font-size="11" font-style="italic" class="label-idira" id="jwt-placeholder">issued on resolve · aud=conjur · alg=RS256 · ttl 5m</text>
    <g id="jwt-fields" style="display:none">
      <text x="116" y="354" font-size="8" font-weight="700" letter-spacing="1.6" class="label-idira">SUB CLAIM</text>
      <text x="116" y="371" font-family="ui-monospace,Menlo" font-size="11" class="label-bright" id="jwt-sub">—</text>
      <text x="116" y="402" font-size="8" font-weight="700" letter-spacing="1.6" class="label-idira">AUD</text>
      <text x="148" y="402" font-family="ui-monospace,Menlo" font-size="11" class="label-bright" id="jwt-aud">—</text>
      <text x="220" y="402" font-size="8" font-weight="700" letter-spacing="1.6" class="label-idira">ALG</text>
      <text x="248" y="402" font-family="ui-monospace,Menlo" font-size="11" class="label-bright" id="jwt-alg">—</text>
      <text x="310" y="402" font-size="8" font-weight="700" letter-spacing="1.6" class="label-idira">KID</text>
      <text x="335" y="402" font-family="ui-monospace,Menlo" font-size="11" class="label-bright" id="jwt-kid">—</text>
      <text x="116" y="434" font-size="8" font-weight="700" letter-spacing="1.6" class="label-idira">TTL</text>
      <text x="142" y="434" font-family="ui-monospace,Menlo" font-size="13" class="label-bright" id="jwt-ttl">—</text>
      <rect x="116" y="446" width="438" height="6" class="ttl-bar"/>
      <rect x="116" y="446" width="0"   height="6" class="ttl-bar-fill" id="jwt-ttl-bar"/>
      <text x="116" y="472" font-size="9" class="label-idira" id="jwt-jwks">signed by trust-domain JWKS</text>
    </g>
    <foreignObject id="jwt-rect-back-fo" x="100" y="304" width="470" height="180" visibility="hidden">
      <div xmlns="http://www.w3.org/1999/xhtml" class="card-back-host" id="jwt-rect-back-host"></div>
    </foreignObject>
    <g class="card-caret" id="jwt-rect-caret" visibility="hidden">
      <path d="M546,312 L556,312 L556,322" stroke="var(--idira-250)" stroke-width="1" fill="none"/>
    </g>
  </g>

  <!-- Connector to SM block -->
  <line x1="335" y1="484" x2="335" y2="514" class="conn" id="to-sm" marker-end="url(#ar)"/>
  <text x="345" y="502" font-size="9" class="label-mute" id="to-sm-label"></text>

  <!-- SM block -->
  <g id="sm-rect-host" class="card-host">
    <rect x="100" y="514" width="470" height="60" class="stage-rect" id="sm-rect"/>
    <text x="116" y="538" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira" id="sm-header">SECRETS MANAGER · SAAS</text>
    <text x="116" y="558" font-size="10" font-style="italic" class="label-idira" id="sm-body">policy scoped to one variable</text>
    <foreignObject id="sm-rect-back-fo" x="100" y="514" width="470" height="60" visibility="hidden">
      <div xmlns="http://www.w3.org/1999/xhtml" class="card-back-host" id="sm-rect-back-host"></div>
    </foreignObject>
    <g class="card-caret" id="sm-rect-caret" visibility="hidden">
      <path d="M546,522 L556,522 L556,532" stroke="var(--idira-250)" stroke-width="1" fill="none"/>
    </g>
  </g>

  <!-- Connector to Secret block -->
  <line x1="335" y1="574" x2="335" y2="604" class="conn" id="to-secret" marker-end="url(#ar)"/>

  <!-- Secret block -->
  <g id="secret-rect-host" class="card-host">
    <rect x="100" y="604" width="470" height="60" class="stage-rect" id="secret-rect"/>
    <text x="116" y="628" font-size="9" font-weight="700" letter-spacing="2.2" class="label-idira" id="secret-header">SECRET</text>
    <text x="116" y="648" font-family="ui-monospace,Menlo" font-size="11" class="label-idira" id="secret-body">in-process · never on disk</text>
    <foreignObject id="secret-rect-back-fo" x="100" y="604" width="470" height="60" visibility="hidden">
      <div xmlns="http://www.w3.org/1999/xhtml" class="card-back-host" id="secret-rect-back-host"></div>
    </foreignObject>
    <g class="card-caret" id="secret-rect-caret" visibility="hidden">
      <path d="M546,612 L556,612 L556,622" stroke="var(--idira-250)" stroke-width="1" fill="none"/>
    </g>
  </g>

  <!-- Hint -->
  <text x="290" y="700" font-size="10" font-weight="700" letter-spacing="2.2" text-anchor="middle" class="hint--idle" id="hint">CLICK RESOLVE TO BEGIN</text>
</svg>`;
}

function paintIdentity(id) {
  setText('td-val', id.trust_domain || '—');
  setText('sg-val', id.server_group || '—');
  setText('ng-val', id.node_group || '—');
  setText('attestor-val', id.attestor || '—');
  paintSVIDCard('portal', id.portal_svid);
  paintSVIDCard('carrier', id.carrier_svid);
}

function paintSVIDCard(role, svid) {
  if (!svid) {
    setText(`${role}-san-1`, 'unavailable');
    setText(`${role}-san-2`, '');
    setText(`${role}-valid-val`, '—');
    return;
  }
  // Split the SPIFFE ID after /kind-ng/ so it wraps cleanly across two lines.
  const uri = svid.san_uri || '';
  const split = uri.indexOf('/ns/');
  if (split > 0) {
    setText(`${role}-san-1`, uri.slice(0, split + 1));
    setText(`${role}-san-2`, uri.slice(split + 1));
  } else {
    setText(`${role}-san-1`, uri);
    setText(`${role}-san-2`, '');
  }
  const ttlMin = computeMinutesLeft(svid.not_after);
  setText(`${role}-valid-val`, `${ttlMin}m`);
  const bar = document.getElementById(`${role}-valid-bar`);
  if (bar) {
    const rot = Math.max(1, svid.rotation_minutes || 60);
    const frac = Math.max(0, Math.min(1, ttlMin / rot));
    bar.setAttribute('width', String(Math.round(226 * frac)));
  }
  setText(`${role}-rotation`, `${svid.key_alg || ''} · rotates ${svid.rotation_minutes || 60}m`);
}

function paintIdentityUnavailable() {
  setText('td-val', 'identity unavailable');
}

function computeMinutesLeft(iso) {
  if (!iso) return 0;
  const exp = Date.parse(iso) / 1000;
  return Math.max(0, Math.floor((exp - Math.floor(Date.now() / 1000)) / 60));
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// Kick off the load. Errors are handled inside loadIdentity().
loadIdentity();

// === SSE consumer: drive state transitions ===
// Single subscription through pace-queue (which owns the only EventSource).
// pace-queue unwraps carrier.event.raw frames before fanout, so dispatch()
// always receives the inner event.
subscribeTrace(dispatch);

function dispatch(ev) {
  const handler = DISPATCH[ev.type];
  if (handler) handler(ev);
  // M7: in foreign-TD mode the dedicated mtls.handshake.err handler below
  // already paints the rejection in the foreign style. Suppress the generic
  // error decorator so .conn--err does not override .conn.rejected.
  if (ev.type === 'mtls.handshake.err' &&
      document.getElementById('carrier-rect')?.classList.contains('foreign')) {
    return;
  }
  if (/\.err$/.test(ev.type)) handleError(ev);
}

const DISPATCH = {
  'portal.resolve.requested': () => {
    resetForReplay();
    setRectState('portal-rect', 'lit');
    setHintHidden(true);
  },
  'portal.resolve.rejected': () => {
    // M7: portal handler emitted a foreign-rejection. Swap the trust evidence
    // panel to the boundary-teaching copy.
    renderRejection();
  },
  'mtls.handshake.start': () => {
    setConnState('mtls-line', 'lit');
    setText('mtls-label', 'mTLS');
    // Optimistically mark carrier as "we're reaching for it" so the card lights
    // in visual order. mtls.handshake.ok is emitted only after the full HTTP
    // response is read, by which time the carrier has already issued the JWT,
    // hit SM, and returned the secret -- leaving carrier-rect dark until last
    // unless we surface a pending state up front.
    setRectState('carrier-rect', 'pending');
  },
  'mtls.peer_uri_seen': (ev) => {
    // M7: portal saw the foreign peer's SAN URI extracted from the
    // CertificateVerificationError. Swap the right card to ACME foreign-TD
    // treatment and render the URI in orange.
    const carrierRect = document.getElementById('carrier-rect');
    const carrierLbl  = document.getElementById('carrier-rect-label');
    if (carrierRect) {
      // Clear any pending/lit state so the .foreign dashed stroke is the
      // dominant visual; .foreign uses --panw-orange dashed per Task 13 CSS.
      setRectState('carrier-rect', null);
      carrierRect.classList.add('foreign');
      // setRectState(null) hid the caret + dropped the host clickable class;
      // the foreign card IS clickable (Task 16 ACME flip-back), so re-enable.
      const caret = document.getElementById('carrier-rect-caret');
      if (caret) caret.setAttribute('visibility', 'visible');
      carrierRect.closest('g.card-host')?.classList.add('stage-host--clickable');
    }
    if (carrierLbl) {
      carrierLbl.textContent = 'ACME · FOREIGN TD';
      carrierLbl.classList.add('label-foreign');
    }
    const san1 = document.getElementById('carrier-san-1');
    const san2 = document.getElementById('carrier-san-2');
    const uri = ev.payload?.uri || '';
    // Split SPIFFE URI after the trust-domain '/' so it wraps cleanly across
    // the two SAN-URI text lines on the card.
    const slash = uri.indexOf('/', 'spiffe://'.length);
    if (san1) {
      san1.textContent = slash >= 0 ? uri.slice(0, slash + 1) : uri;
      san1.classList.add('uri-foreign');
    }
    if (san2) {
      san2.textContent = slash >= 0 ? uri.slice(slash + 1) : '';
      san2.classList.add('uri-foreign');
    }
    // Stash the foreign cert state for the card-back ACME renderer.
    setForeignCertState({ uri });
  },
  'mtls.handshake.err': (ev) => {
    // M7: if the right card is already painted foreign (peer_uri_seen fired
    // first), this is a trust-boundary rejection. Mark the connector
    // rejected, swap the eyebrow text to the rejection legend, dim the
    // downstream stack, and append the TRUST BOUNDARY tile. Otherwise this
    // is an internal-flow mTLS failure; fall back to the legacy behaviour
    // (mark carrier-rect as err so it stops sitting half-lit).
    const carrierRect = document.getElementById('carrier-rect');
    const isForeign = carrierRect?.classList.contains('foreign');
    if (!isForeign) {
      setRectState('carrier-rect', 'err');
      return;
    }
    const conn = document.getElementById('mtls-line');
    if (conn) conn.classList.add('rejected');
    const eyebrow = document.getElementById('mtls-label');
    if (eyebrow) {
      const msg = String(ev.payload?.err || '').toLowerCase();
      eyebrow.textContent = msg.includes('unknown authority')
        ? 'mTLS REJECTED · UNTRUSTED AUTHORITY'
        : 'mTLS FAILED';
      eyebrow.classList.add('eyebrow-rejected');
    }
    // Dim the downstream stack -- nothing past mTLS ran.
    ['jwt-rect-host', 'sm-rect-host', 'secret-rect-host'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('stage-skipped');
    });
    appendTrustBoundaryTile();
  },
  'mtls.handshake.ok': (ev) => {
    setRectState('carrier-rect', 'lit');
    setText('mtls-label', 'mTLS OK');
    setText('mtls-cipher', shortCipher(ev.payload?.cipher) || '');
  },
  'jwt_svid.issued': (ev) => {
    setRectState('jwt-rect', 'hero');
    document.getElementById('jwt-placeholder').style.display = 'none';
    document.getElementById('jwt-fields').style.display = '';
    setText('jwt-sub', ev.payload?.spiffe_id || '');
    setText('jwt-aud', ev.payload?.aud || '');
    setText('jwt-alg', ev.payload?.alg || '');
    const kid = ev.payload?.kid || '';
    setText('jwt-kid', kid.length > 12 ? kid.split('-')[0] + '…' : kid);
    setText('jwt-header', 'CARRIER · JWT-SVID  ·  PRESENTING');
    setConnState('to-sm', 'pending');
    setText('to-sm-label', 'POST /api/authn-jwt/… (in flight)');
    setRectState('sm-rect', 'pending');
    setText('sm-body', 'validating JWT against tenant JWKS…');
    // Start TTL ticker now; sm.authn_jwt.ok will flip header to "ACCEPTED".
    const exp = Number(ev.payload?.exp) || (Math.floor(Date.now() / 1000) + 300);
    // Issued-at not on payload; approximate iat as now (TTL bar starts at ~100%).
    setIssuedAndExp(Math.floor(Date.now() / 1000), exp);
  },
  'sm.authn_jwt.ok': () => {
    setRectState('sm-rect', 'lit');
    setText('sm-header', 'SECRETS MANAGER · SAAS  ·  TOKEN GRANTED');
    setText('sm-body', `scoped to ${currentSecretID()} · policy denies all others`);
    setText('jwt-header', 'CARRIER · JWT-SVID  ·  ACCEPTED');
    setConnState('to-sm', 'lit');
    setConnState('to-secret', 'lit');
  },
  'sm.secret_fetched.ok': (ev) => {
    setRectState('secret-rect', 'lit');
    setText('secret-header', 'SECRET RETURNED');
    const bytes = ev.payload?.bytes ?? 0;
    setText('secret-body', `bytes=${bytes} · in-process · held for one request · never on disk`);
  },
};

function handleError(ev) {
  // Map error event type to the SVG element id and whether it's a rect or a line.
  const target = ERROR_MAP[ev.type];
  if (!target) return;
  if (target.kind === 'rect') setRectState(target.id, 'err');
  else                        setConnState(target.id, 'err');
  // Caption: keep short -- payload.err truncated to 90 chars.
  const caption = String(ev.payload?.err || ev.type).slice(0, 90);
  appendErrorCaption(target.id, caption);
}

const ERROR_MAP = {
  'mtls.handshake.err':       { id: 'mtls-line',    kind: 'line' },
  'jwt_svid.error':           { id: 'jwt-rect',     kind: 'rect' },
  'sm.authn_jwt.err':         { id: 'sm-rect',      kind: 'rect' },
  'sm.secret_fetched.err':    { id: 'secret-rect',  kind: 'rect' },
  'sm.secret_fetched.empty':  { id: 'secret-rect',  kind: 'rect' },
};

function setRectState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('stage-rect--lit', 'stage-rect--hero', 'stage-rect--pending', 'stage-rect--err');
  if (state) el.classList.add(`stage-rect--${state}`);
  // Caret + clickable-cursor visibility tied to lit / hero / err states. The
  // pending state is not flippable: the card has no data yet to back-render.
  const clickable = state === 'lit' || state === 'hero' || state === 'err';
  const caret = document.getElementById(id + '-caret');
  if (caret) caret.setAttribute('visibility', clickable ? 'visible' : 'hidden');
  const host = el.closest('g.card-host');
  if (host) host.classList.toggle('stage-host--clickable', clickable);
}

function setConnState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('conn--lit', 'conn--pending', 'conn--err');
  if (state) el.classList.add(`conn--${state}`);
}

function setHintHidden(hidden) {
  const el = document.getElementById('hint');
  if (!el) return;
  el.classList.toggle('hint--hidden', hidden);
}

function appendErrorCaption(stageId, text) {
  // Caption placed below the failing stage. One caption per stage; replace if re-fired.
  const existing = document.getElementById(`${stageId}-err-caption`);
  if (existing) existing.remove();

  const target = document.getElementById(stageId);
  if (!target) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  const cap = document.createElementNS(svgNS, 'text');
  cap.id = `${stageId}-err-caption`;
  cap.setAttribute('class', 'err-caption');
  cap.setAttribute('font-size', '9');
  // Coordinates differ for <rect> (x/y/height) vs <line> (x1/y1/y2).
  let x, y;
  if (target.tagName === 'rect') {
    x = parseFloat(target.getAttribute('x') || '0') + 16;
    y = parseFloat(target.getAttribute('y') || '0') + parseFloat(target.getAttribute('height') || '0') + 18;
  } else {
    // For a horizontal line, anchor below its midpoint.
    const x1 = parseFloat(target.getAttribute('x1') || '0');
    const x2 = parseFloat(target.getAttribute('x2') || '0');
    const y1 = parseFloat(target.getAttribute('y1') || '0');
    x = (x1 + x2) / 2 - 40;
    y = y1 + 24;
  }
  cap.setAttribute('x', String(x));
  cap.setAttribute('y', String(y));
  cap.textContent = text;
  target.parentNode.appendChild(cap);
}

function resetForReplay() {
  // Called on portal.resolve.requested. Returns all stages below the hierarchy ribbon to idle.
  ['portal-rect', 'carrier-rect', 'jwt-rect', 'sm-rect', 'secret-rect'].forEach(id => setRectState(id, null));
  ['mtls-line', 'to-jwt', 'to-sm', 'to-secret', 'branch-stem', 'branch-cross', 'branch-l', 'branch-r'].forEach(id => setConnState(id, 'lit'));
  // Restore branch connectors to lit immediately -- they reflect static hierarchy, not flow.
  setText('mtls-label', 'mTLS');
  setText('mtls-cipher', '');
  setText('to-sm-label', '');
  setText('sm-header', 'SECRETS MANAGER · SAAS');
  setText('sm-body', 'policy scoped to one variable');
  setText('secret-header', 'SECRET');
  setText('secret-body', 'in-process · never on disk');
  setText('jwt-header', 'CARRIER · JWT-SVID');
  document.getElementById('jwt-placeholder').style.display = '';
  document.getElementById('jwt-fields').style.display = 'none';
  // Remove any prior error captions.
  document.querySelectorAll('[id$="-err-caption"]').forEach(el => el.remove());
}

function shortCipher(name) {
  if (!name) return '';
  // TLS_AES_128_GCM_SHA256 → keep as-is but cap at 22 chars for visual fit.
  return name.length > 22 ? name.slice(0, 22) + '…' : name;
}

function currentSecretID() {
  return identityCache?.secret_id || 'swa-demo/carrier/api-key';
}

// appendTrustBoundaryTile renders the M7 educational tile beneath the
// existing stack when the foreign rejection completes. Idempotent: bails if
// the tile is already present. Removed by resetDiagram() on carrier toggle.
function appendTrustBoundaryTile() {
  if (document.getElementById('tile-boundary')) return;
  const svg = document.querySelector('#diagram svg');
  if (!svg) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'tile-boundary';
  g.innerHTML = `
    <rect x="10" y="620" width="560" height="80" class="tile-boundary"/>
    <text x="22" y="640" class="tile-boundary-label">TRUST BOUNDARY</text>
    <text x="22" y="660" class="tile-boundary-body">acme.courier is outside idira.demo. No shared trust roots.</text>
    <text x="22" y="676" class="tile-boundary-body">SWA trust-domain federation would resolve this; not yet available.</text>
  `;
  svg.appendChild(g);
}

// === TTL countdown wiring ===
// Single subscription drives the JWT hero TTL text + bar in the right pane.
// The left-pane evidence card subscribes separately (evidence.js).

subscribeTTL(({ remaining, fraction }) => {
  const text = document.getElementById('jwt-ttl');
  const bar  = document.getElementById('jwt-ttl-bar');
  if (text) text.textContent = remaining === 0 ? 'expired' : formatMSS(remaining);
  if (bar)  bar.setAttribute('width', String(Math.round(438 * fraction)));
  // Border flips orange when expired.
  if (remaining === 0) setRectState('jwt-rect', 'err');
});

// === CTA flip: RESOLVE ↔ SKIP ===
// While pace-queue is draining a walk, the resolve button becomes SKIP.
// Clicking SKIP calls skipPace() which collapses the rest of the queue to
// real-time so all remaining stages paint immediately.

const cta = document.querySelector('button.cta');
let originalLabel = cta?.textContent || 'RESOLVE SECRET';

onStateChange((state) => {
  if (!cta) return;
  if (state === 'walking') {
    if (cta.textContent !== 'SKIP') originalLabel = cta.textContent;
    cta.textContent = 'SKIP';
    cta.dataset.paceMode = 'skip';
  } else {
    cta.textContent = originalLabel;
    delete cta.dataset.paceMode;
  }
});

// Intercept clicks while in SKIP mode and route to skip() instead of letting
// the form submit. The existing form submit handler (in portal.js) is
// untouched; it only runs when paceMode is unset.
cta?.addEventListener('click', (e) => {
  if (cta.dataset.paceMode === 'skip') {
    e.preventDefault();
    e.stopImmediatePropagation();
    skipPace();
  }
}, true);  // capture phase so this fires before portal.js's submit handler

// === Flip-card wiring ===
// Click handlers: only fire when the card is lit/hero/err. Cross-card flip
// flows through flip-controller (which auto-unflips the prior). Background
// click on the inspector pane unflips. flipChange swaps foreignObject
// visibility at the animation midpoint (125ms of the 250ms scaleX).

const CARD_IDS = ['portal-rect', 'carrier-rect', 'jwt-rect', 'sm-rect', 'secret-rect'];

for (const cid of CARD_IDS) {
  const host = document.getElementById(cid + '-host');
  if (!host) continue;
  host.addEventListener('click', () => {
    const rect = document.getElementById(cid);
    if (!rect) return;
    const cls = rect.classList;
    if (!cls.contains('stage-rect--lit') &&
        !cls.contains('stage-rect--hero') &&
        !cls.contains('stage-rect--err') &&
        !cls.contains('foreign')) return;
    flipTo(currentlyFlipped() === cid ? null : cid);
  });
}

// Escape-hatch: click on inspector background (anywhere outside a card-host)
// unflips. Listener is on the inspector pane so left-pane and chrome clicks
// don't trigger it.
document.querySelector('.pane--inspector')?.addEventListener('click', (e) => {
  if (!e.target.closest('g.card-host')) flipTo(null);
});

onFlipChange((prev, next) => {
  if (prev) {
    const ph = document.getElementById(prev + '-host');
    ph?.classList.remove('flipped');
    const pfo = document.getElementById(prev + '-back-fo');
    if (pfo) pfo.setAttribute('visibility', 'hidden');
  }
  if (next) {
    // Render the back fresh from cache so the user sees the latest payload.
    const backHost = document.getElementById(next + '-back-host');
    if (backHost) backHost.innerHTML = renderBack(next);
    const host = document.getElementById(next + '-host');
    host?.classList.add('flipping');
    setTimeout(() => host?.classList.remove('flipping'), 250);
    // Visibility swap at the animation midpoint (125ms of the 250ms scaleX).
    setTimeout(() => {
      host?.classList.add('flipped');
      const fo = document.getElementById(next + '-back-fo');
      if (fo) fo.setAttribute('visibility', 'visible');
    }, 125);
  }
});
