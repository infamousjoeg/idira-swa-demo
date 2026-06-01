// pacing-control.js -- chrome toggle UI for pace selection (off/fast/medium/slow).

import { setPace } from './pace-queue.js';

const OPTIONS = [
  { key: 'off',    label: 'off' },
  { key: 'fast',   label: 'fast' },
  { key: 'medium', label: 'medium' },
  { key: 'slow',   label: 'slow' },
];

const STORAGE_KEY = 'idira.pace';
const DEFAULT_KEY = 'medium';

// Resolve initial value: URL param wins, then localStorage, then default.
function resolveInitial() {
  const url = new URL(window.location.href);
  const fromURL = url.searchParams.get('pace');
  if (fromURL !== null) {
    return { key: normalize(fromURL), fromURL: true };
  }
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
  if (stored) {
    return { key: normalize(stored), fromURL: false };
  }
  return { key: DEFAULT_KEY, fromURL: false };
}

// Map any incoming string to a known option key. Numeric strings stay as
// their number value (escape hatch for raw ms tuning). Unknown values fall
// back to default.
function normalize(raw) {
  const lower = String(raw).toLowerCase();
  if (OPTIONS.some(o => o.key === lower)) return lower;
  if (lower === '0') return 'off';
  if (lower === '150') return 'fast';
  if (lower === '300') return 'medium';
  if (lower === '600') return 'slow';
  const n = Number(lower);
  if (Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_KEY;
}

function render(host, activeKey) {
  host.innerHTML = '';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'pace-control__eyebrow';
  eyebrow.textContent = 'PACE';
  host.appendChild(eyebrow);

  for (const opt of OPTIONS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pace-control__opt' + (opt.key === activeKey ? ' pace-control__opt--active' : '');
    el.dataset.pace = opt.key;
    el.textContent = opt.label;
    el.addEventListener('click', () => select(host, opt.key));
    host.appendChild(el);
  }
}

function select(host, key) {
  setPace(key);
  try { localStorage.setItem(STORAGE_KEY, String(key)); } catch { /* ignore */ }
  // Re-render to flip active state.
  render(host, key);
}

// === init on import ===
const host = document.getElementById('pace-control');
if (host) {
  const initial = resolveInitial();
  setPace(initial.key);
  render(host, initial.key);
}
