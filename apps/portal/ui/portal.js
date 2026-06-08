import { resetDiagram } from './diagram.js';

const form    = document.getElementById('resolveForm');
const result  = document.getElementById('result');
const button  = form.querySelector('button.cta');
const input   = form.querySelector('input[name="shipment_id"]');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = input.value.trim();
  if (!id) return;

  button.disabled = true;
  result.innerHTML = '';

  // M7: include the carrier choice from the segmented selector. The handler
  // defaults to "internal" if the field is absent or the selector is somehow
  // unchecked, preserving M1-M6 single-carrier behaviour.
  const carrierChoice =
    form.querySelector('input[name="carrier"]:checked')?.value || 'internal';

  try {
    const resp = await fetch('/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipment_id: id, carrier: carrierChoice }),
    });
    if (resp.status === 404) {
      renderRow(result, 'status', 'shipment not found');
      return;
    }
    if (!resp.ok) {
      renderRow(result, 'status', `error · ${resp.status}`);
      return;
    }
    const data = await resp.json();
    renderResult(result, data);
  } catch (err) {
    renderRow(result, 'error', String(err));
  } finally {
    button.disabled = false;
  }
});

function renderResult(root, data) {
  const order = ['shipment_id', 'origin', 'destination', 'eta', 'carrier_name'];
  for (const k of order) {
    if (k in data) renderRow(root, k.replace(/_/g, ' '), data[k]);
  }
}

function renderRow(root, k, v) {
  const row = document.createElement('div');
  row.className = 'result__row';

  const kEl = document.createElement('span');
  kEl.className = 'result__k';
  kEl.textContent = k;

  const vEl = document.createElement('span');
  vEl.className = 'result__v';
  vEl.textContent = v;

  row.append(kEl, vEl);
  root.append(row);
}

// M7: reset the diagram + result pane whenever the carrier selector flips.
// This is the demo's only "reset" affordance per spec section 7.1.
document.querySelectorAll('input[name="carrier"]').forEach(r => {
  r.addEventListener('change', () => {
    resetDiagram();
    if (result) result.innerHTML = '';
  });
});
