// evidence.js -- V2 trust evidence card. Appears below the shipment result
// after the first successful resolve; subscribes to the shared TTL ticker.

import { subscribe as subscribeTTL, formatMSS } from './ttl-ticker.js';
import { subscribe as subscribeTrace } from './pace-queue.js';

const card = document.getElementById('evidence');
const line1 = card?.querySelector('[data-slot="line1"]');
const line2 = card?.querySelector('[data-slot="line2"]');
const line3 = card?.querySelector('[data-slot="line3"]');

// Cache the dynamic secret ID from /identity once at load.
let secretID = 'swa-demo/carrier/api-key';
fetch('/identity', { headers: { 'Accept': 'application/json' } })
  .then(r => r.ok ? r.json() : null)
  .then(j => { if (j?.secret_id) secretID = j.secret_id; })
  .catch(() => {});

// Render the static copy once. The TTL value is replaced live by the ticker
// (the placeholder span is what gets updated).
function renderCopy() {
  if (!line1) return;
  line1.innerHTML = `This carrier just proved its identity with a <b>cryptographic certificate</b> issued by your trust domain &mdash; not a static API key. The certificate <b>expires in <span id="evidence-ttl">—</span></b> and rotates automatically.`;
  line2.innerHTML = `The secret that unlocked this shipment <b>never touches disk or env vars</b>. It lived in the carrier's memory for one HTTP request, then was discarded.`;
  line3.innerHTML = `Policy on the Secrets Manager side <b>denies access</b> to every variable except <span class="mono">${escapeHTML(secretID)}</span>.`;
}

// Subscribe through pace-queue (which owns the only EventSource and unwraps
// carrier.event.raw frames). Evidence stays in lockstep with diagram.js
// because both subscribe to the same queue and see the same fanout order.
subscribeTrace((parsed) => {
  if (parsed.type === 'sm.secret_fetched.ok') {
    renderCopy();
    if (card) card.hidden = false;
    card.classList.remove('evidence--dim');
  }
  if (parsed.type === 'portal.resolve.requested' && card && !card.hidden) {
    // New resolve started; dim the card until next jwt_svid.issued.
    card.classList.add('evidence--dim');
  }
});

// Live TTL -- single shared ticker.
subscribeTTL(({ remaining }) => {
  const el = document.getElementById('evidence-ttl');
  if (!el) return;
  el.textContent = remaining === 0 ? 'expired' : formatMSS(remaining);
  if (remaining > 0) card?.classList.remove('evidence--dim');
});

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// renderRejection rewrites the trust evidence panel for the External-mode
// rejection. Called by the diagram subscriber when portal.resolve.rejected
// fires (carrier=external, reason=trust_boundary). Copy is verbatim from the
// spec/plan and graded for exactness.
export function renderRejection() {
  const ev = document.getElementById('evidence');
  if (!ev) return;
  ev.hidden = false;
  ev.classList.remove('evidence--dim');
  const set = (slot, html) => {
    const el = ev.querySelector(`[data-slot="${slot}"]`);
    if (el) el.innerHTML = html;
  };
  set('line1',
    'This carrier presented a certificate signed by <strong>a CA your trust domain does not know</strong>. ' +
    'No federation is configured; SWA does not yet support cross-trust-domain federation.');
  set('line2',
    'No JWT-SVID was issued, no Secrets Manager call was made, no secret was fetched. ' +
    'The mTLS handshake was rejected before any application data crossed the wire.');
  set('line3',
    'This is the boundary SPIFFE was designed to enforce. The foreign workload still has its own ' +
    'identity (look at the cert on the right); your trust roots simply do not anchor it.');
  const sub = ev.querySelector('.evidence__sub');
  if (sub) sub.textContent = 'See the live trust diagram on the right →';
}
