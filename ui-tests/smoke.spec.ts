import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EXPECTED_EVENT_TYPES = [
  'portal.resolve.requested',
  'mtls.handshake.start',
  'jwt_svid.issued',
  'sm.authn_jwt.ok',
  'sm.secret_fetched.ok',
  'carrier.lookup.ok',
];

test('portal loads with brand-correct shell', async ({ page }) => {
  await page.goto('/?pace=off');
  await expect(page).toHaveTitle(/Praetor Logistics/);
  await expect(page.locator('.lockup__mark')).toHaveText('Idira');
  await expect(page.locator('.cta')).toHaveText('RESOLVE SECRET');

  // No emoji anywhere in the rendered DOM.
  const text = await page.evaluate(() => document.body.innerText);
  // eslint-disable-next-line no-misleading-character-class
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

  // No forbidden CSS patterns.
  const styles = await page.evaluate(() => {
    return Array.from(document.styleSheets).flatMap(s => {
      try { return Array.from(s.cssRules).map(r => (r as CSSRule).cssText); }
      catch { return []; }
    }).join('\n');
  });
  expect(styles).not.toMatch(/linear-gradient[^;]*\b(purple|pink|magenta|violet)\b/i);
  expect(styles).not.toMatch(/\bshadcn\b/i);

  // Body font must be Helvetica Neue (or its named fallback chain), not SF Pro.
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(body).toMatch(/Helvetica/);

  // Diagram present, hierarchy ribbon populated from /identity.
  await expect(page.locator('#diagram svg')).toBeVisible();
  await expect(page.locator('#td-val')).toHaveText('idira.demo');
  await expect(page.locator('#sg-val')).toHaveText('kind-sg');
  await expect(page.locator('#ng-val')).toHaveText('kind-ng');
  await expect(page.locator('#attestor-val')).toHaveText('k8s_psat');

  // Idle hint visible.
  await expect(page.locator('#hint')).toHaveText('CLICK RESOLVE TO BEGIN');
  await expect(page.locator('#hint')).not.toHaveClass(/hint--hidden/);

  // Trust evidence card initially hidden.
  await expect(page.locator('#evidence')).toBeHidden();

  fs.mkdirSync('../out', { recursive: true });
  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-empty.png'), fullPage: true });
});

test('resolving a shipment drives the full SPIFFE → SM → fixture sequence', async ({ page }) => {
  const events: string[] = [];

  // Subscribe to /trace via fetch + ReadableStream so we observe the same SSE
  // the UI sees, but in a buffer the test can assert on.
  await page.exposeFunction('recordEvent', (t: string) => { events.push(t); });
  await page.addInitScript(() => {
    const es = new EventSource('/trace');
    es.onmessage = (ev) => {
      try {
        let parsed = JSON.parse(ev.data);
        if (parsed.type === 'carrier.event.raw' && parsed.payload?.frame) {
          parsed = JSON.parse(parsed.payload.frame);
        }
        // @ts-ignore
        window.recordEvent(parsed.type);
      } catch {}
    };
  });

  await page.goto('/?pace=off');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');

  await expect(page.locator('.result__row').first()).toBeVisible({ timeout: 5000 });

  // All six expected event types must have arrived within the test timeout.
  await expect.poll(() => EXPECTED_EVENT_TYPES.every(t => events.includes(t)),
    { timeout: 5000 }).toBe(true);

  // Diagram lit through: portal card, carrier card, JWT hero, SM block, secret block.
  await expect(page.locator('#portal-rect')).toHaveClass(/stage-rect--lit/, { timeout: 5000 });
  await expect(page.locator('#carrier-rect')).toHaveClass(/stage-rect--lit/, { timeout: 5000 });
  await expect(page.locator('#jwt-rect')).toHaveClass(/stage-rect--hero/, { timeout: 5000 });
  await expect(page.locator('#sm-rect')).toHaveClass(/stage-rect--lit/, { timeout: 5000 });
  await expect(page.locator('#secret-rect')).toHaveClass(/stage-rect--lit/, { timeout: 5000 });

  // JWT-SVID populated fields.
  await expect(page.locator('#jwt-sub')).toHaveText(/^spiffe:\/\/idira\.demo\/.*\/sa\/carrier$/);
  await expect(page.locator('#jwt-aud')).toHaveText('conjur');
  await expect(page.locator('#jwt-alg')).not.toBeEmpty();
  await expect(page.locator('#jwt-kid')).not.toBeEmpty();
  await expect(page.locator('#jwt-ttl')).toHaveText(/^\d+m \d{2}s$/);

  // SM and secret state.
  await expect(page.locator('#sm-header')).toHaveText(/TOKEN GRANTED/);
  await expect(page.locator('#secret-body')).toHaveText(/bytes=\d+/);

  // Trust evidence card visible with live TTL value.
  await expect(page.locator('#evidence')).toBeVisible();
  await expect(page.locator('#evidence-ttl')).toHaveText(/^\d+m \d{2}s$/);

  // Hint hidden.
  await expect(page.locator('#hint')).toHaveClass(/hint--hidden/);

  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-resolved.png'), fullPage: true });
});

test('unknown shipment surfaces not-found, does NOT crash UI', async ({ page }) => {
  await page.goto('/?pace=off');
  await page.fill('input[name="shipment_id"]', 'SHP-DOES-NOT-EXIST');
  await page.click('button.cta');
  await expect(page.locator('.result__row .result__v').first()).toHaveText(/not found/i, { timeout: 5000 });
});

test('ttl counts down live and stays in sync between panes', async ({ page }) => {
  await page.goto('/?pace=off');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await expect(page.locator('#evidence-ttl')).toHaveText(/^\d+m \d{2}s$/, { timeout: 5000 });

  const t0Right = await page.locator('#jwt-ttl').textContent();
  const t0Left  = await page.locator('#evidence-ttl').textContent();
  // Same value (within 1 s) at the same instant — they share a ticker.
  expect(t0Right).toBe(t0Left);

  await page.waitForTimeout(2200);

  const t1Right = await page.locator('#jwt-ttl').textContent();
  // Strictly less after >2s.
  expect(secondsOf(t1Right!)).toBeLessThan(secondsOf(t0Right!));
});

test('no AI-generation markers in diagram or evidence', async ({ page }) => {
  await page.goto('/?pace=off');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await expect(page.locator('#evidence')).toBeVisible({ timeout: 5000 });

  // No emoji codepoints anywhere in rendered text.
  const text = await page.evaluate(() => document.body.innerText);
  // eslint-disable-next-line no-misleading-character-class
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

  // No purple/pink hues in computed styles of diagram or evidence elements.
  const hues = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll('#diagram *'),
      ...document.querySelectorAll('#evidence, #evidence *'),
    ];
    return els.map(el => {
      const s = getComputedStyle(el);
      return [s.color, s.fill, s.stroke, s.backgroundColor, s.borderColor].join(' ');
    }).join(' ');
  });
  expect(hues).not.toMatch(/rgb\(\s*(?:1[5-9][0-9]|2[0-4][0-9])\s*,\s*[0-9]{1,2}\s*,\s*(?:1[5-9][0-9]|2[0-4][0-9])/);
  // (Heuristic: matches purple/magenta R,G,B where R high, G low, B high.)

  // No border-radius > 0 inside #diagram and #evidence.
  const radii = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll('#diagram *'),
      ...document.querySelectorAll('#evidence, #evidence *'),
    ];
    return els.map(el => getComputedStyle(el).borderRadius);
  });
  for (const r of radii) {
    expect(r === '0px' || r === '').toBeTruthy();
  }
});

function secondsOf(mss: string): number {
  // "4m 58s" → 298
  const m = mss.match(/(\d+)m\s+(\d+)s/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

test('carrier unreachable: mtls stage shows error, evidence stays hidden', async ({ page }) => {
  // Scale carrier to 0; revert at end. Skip if kubectl unavailable.
  const { execSync } = require('child_process');
  try {
    execSync('kubectl -n swa-demo scale deploy/carrier --replicas=0', { stdio: 'pipe' });
  } catch {
    test.skip(true, 'kubectl not available for failure-path test');
    return;
  }
  try {
    // Wait briefly for endpoints to drain.
    execSync('sleep 3');

    await page.goto('/?pace=off');
    await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
    await page.click('button.cta');

    // mTLS line picks up conn--err class. ERROR_MAP routes mtls.handshake.err
    // to mtls-line with kind=line; setConnState applies the class.
    await expect(page.locator('#mtls-line')).toHaveClass(/conn--err/, { timeout: 8000 });

    // Carrier card never lit.
    await expect(page.locator('#carrier-rect')).not.toHaveClass(/stage-rect--lit/);

    // Error caption visible somewhere in the diagram.
    await expect(page.locator('#mtls-line-err-caption')).toBeVisible();

    // Evidence card MUST stay hidden — we never reached sm.secret_fetched.ok.
    await expect(page.locator('#evidence')).toBeHidden();
  } finally {
    execSync('kubectl -n swa-demo scale deploy/carrier --replicas=1', { stdio: 'pipe' });
    execSync('kubectl -n swa-demo wait --for=condition=available --timeout=60s deploy/carrier', { stdio: 'pipe' });
  }
});

test('paced walk reveals stages sequentially under ?pace=slow', async ({ page }) => {
  await page.goto('/?pace=slow');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');

  // Immediately after click (well under one slow-pace tick of 600ms):
  // portal-rect should already be lit, but secret-rect MUST NOT be.
  await expect(page.locator('#portal-rect')).toHaveClass(/stage-rect--lit/, { timeout: 1500 });
  await expect(page.locator('#secret-rect')).not.toHaveClass(/stage-rect--lit/);

  // After the full slow walk (sum of weights ≈ 6.7 × 600ms ≈ 4s + slack),
  // all stages should be lit and the secret block painted.
  await expect(page.locator('#secret-rect')).toHaveClass(/stage-rect--lit/, { timeout: 8000 });
  await expect(page.locator('#sm-rect')).toHaveClass(/stage-rect--lit/);
  await expect(page.locator('#jwt-rect')).toHaveClass(/stage-rect--hero/);
});
