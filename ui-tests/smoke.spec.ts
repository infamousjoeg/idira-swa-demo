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
  await page.goto('/');
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

  await page.goto('/');
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');

  await expect(page.locator('.result__row').first()).toBeVisible({ timeout: 5000 });

  // All six expected event types must have arrived within the test timeout.
  await expect.poll(() => EXPECTED_EVENT_TYPES.every(t => events.includes(t)),
    { timeout: 5000 }).toBe(true);

  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-resolved.png'), fullPage: true });
});

test('unknown shipment surfaces not-found, does NOT crash UI', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[name="shipment_id"]', 'SHP-DOES-NOT-EXIST');
  await page.click('button.cta');
  await expect(page.locator('.result__row .result__v').first()).toHaveText(/not found/i, { timeout: 5000 });
});
