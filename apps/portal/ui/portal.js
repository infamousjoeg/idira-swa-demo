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

  try {
    const resp = await fetch('/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipment_id: id }),
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
