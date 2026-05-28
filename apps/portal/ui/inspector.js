const trace = document.getElementById('trace');
const es    = new EventSource('/trace');

es.onmessage = (ev) => {
  let event;
  try { event = JSON.parse(ev.data); } catch { return; }
  // carrier.event.raw frames are JSON-encoded events from carrier; unwrap them.
  if (event.type === 'carrier.event.raw' && event.payload && event.payload.frame) {
    try { event = JSON.parse(event.payload.frame); } catch {}
  }
  renderTrace(event);
};

es.onerror = () => {
  // Browser auto-reconnects EventSource; surface a quiet status line.
  renderTrace({
    ts: new Date().toISOString(),
    source: 'portal',
    type: 'trace.reconnecting',
    payload: {},
  }, /*err*/ true);
};

function renderTrace(ev, err) {
  const li = document.createElement('li');
  li.className = 'trace__row';

  const ts = document.createElement('span');
  ts.className = 'trace__ts';
  ts.textContent = formatTs(ev.ts);

  const src = document.createElement('span');
  src.className = 'trace__src';
  src.textContent = (ev.source || 'unknown').toLowerCase();

  const body = document.createElement('span');
  body.className = 'trace__body' + (err || /\.err$/.test(ev.type) ? ' trace__body--err' : '');
  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = ev.type;
  body.append(pill);

  const sub = summarizePayload(ev.payload);
  if (sub) body.append(document.createTextNode(sub));

  li.append(ts, src, body);
  trace.append(li);
  // Keep the latest 200 rows; older fade off.
  while (trace.childElementCount > 200) trace.firstElementChild.remove();
  li.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function formatTs(s) {
  if (!s) return '';
  const d = new Date(s);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function summarizePayload(p) {
  if (!p) return '';
  if (p.spiffe_id) return p.spiffe_id;
  if (p.peer)      return p.peer;
  if (p.peer_host) return p.peer_host;
  if (p.id)        return `id=${p.id}`;
  if (p.bytes)     return `bytes=${p.bytes}`;
  if (p.err)       return p.err;
  return '';
}
