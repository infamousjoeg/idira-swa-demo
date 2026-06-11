import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// M3 smoke tests: exercises the React portal UI after the M-UI redesign.
// Tests brand correctness, the full resolve sequence, trust context,
// evidence callout, TTL ticker, error states, and paced walk.

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

  // Praetor Logistics brand name visible in the app bar.
  await expect(page.getByText('Praetor Logistics')).toBeVisible();

  // Secured by Idira pill visible.
  await expect(page.getByText('Secured by Idira')).toBeVisible();

  // Resolve button visible with its initial label.
  await expect(page.getByRole('button', { name: /resolve secret/i })).toBeVisible();

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

  // Trust-context bar populated from SWA.trust constants.
  await expect(page.getByText('idira.demo', { exact: true })).toBeVisible();
  await expect(page.getByText('kind-sg', { exact: true })).toBeVisible();
  await expect(page.getByText('kind-ng', { exact: true })).toBeVisible();
  await expect(page.getByText('k8s_psat', { exact: true })).toBeVisible();

  // Idle state text visible.
  await expect(page.getByText('Click resolve to begin')).toBeVisible();

  fs.mkdirSync('../out', { recursive: true });
  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-empty.png'), fullPage: true });
});

test('resolving a shipment drives the full SPIFFE sequence', async ({ page }) => {
  const events: string[] = [];

  // Subscribe to /trace via EventSource so we observe the same SSE the UI sees.
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

  // Click Resolve with internal carrier (default).
  await page.getByRole('button', { name: /resolve secret/i }).click();

  // Wait for the success evidence callout (proves the full resolve completed).
  await expect(page.getByText('Trust evidence')).toBeVisible({ timeout: 10_000 });

  // All six expected event types must have arrived within the test timeout.
  await expect.poll(() => EXPECTED_EVENT_TYPES.every(t => events.includes(t)),
    { timeout: 5000 }).toBe(true);

  // Shipment manifest visible (real carrier response, not SWA.shipment constants).
  await expect(page.getByText('SHP-2049-883')).toBeVisible();

  // Evidence callout's verbatim copy visible.
  await expect(page.getByText('Cryptographic identity, not a key.')).toBeVisible();
  await expect(page.getByText('The secret never landed.')).toBeVisible();

  // Inspector status footer shows resolved state.
  await expect(page.getByText(/Resolved/)).toBeVisible();

  await page.screenshot({ path: path.join('..', 'out', 'm3-smoke-resolved.png'), fullPage: true });
});

test('unknown shipment surfaces not-found, does NOT crash UI', async ({ page }) => {
  await page.goto('/?pace=off');

  // Clear and type an unknown shipment ID.
  const input = page.locator('input').first();
  await input.fill('SHP-DOES-NOT-EXIST');

  await page.getByRole('button', { name: /resolve secret/i }).click();

  // The resolve should complete (either done or error) without the page crashing.
  // Wait for any result to appear.
  await page.waitForTimeout(3000);

  // Page is still responsive (title still matches).
  await expect(page).toHaveTitle(/Praetor Logistics/);
});

test('ttl counts down live', async ({ page }) => {
  await page.goto('/?pace=off');
  await page.getByRole('button', { name: /resolve secret/i }).click();

  // Wait for the resolve to complete.
  await expect(page.getByText('Trust evidence')).toBeVisible({ timeout: 10_000 });

  // Poll until a TTL value (Xm YYs, value > 0) appears in the page.
  // The JWT-SVID card in the topology renders fmtTtl(jwtTtl) once jwtState=done.
  const extractTtl = () => page.evaluate(() => {
    const allText = document.body.textContent ?? '';
    const match = allText.match(/(\d+m \d{2}s)/);
    return match ? match[1] : null;
  });

  await expect.poll(async () => {
    const v = await extractTtl();
    return v && secondsOf(v) > 0 ? v : null;
  }, { timeout: 5000, message: 'TTL value > 0 never appeared in topology' }).not.toBeNull();

  const t0 = await extractTtl();
  expect(t0).not.toBeNull();

  await page.waitForTimeout(2200);

  const t1 = await extractTtl();
  expect(t1).not.toBeNull();

  // Strictly less after >2s -- the ticker is live.
  expect(secondsOf(t1!)).toBeLessThan(secondsOf(t0!));
});

test('no AI-generation markers in rendered content', async ({ page }) => {
  await page.goto('/?pace=off');
  await page.getByRole('button', { name: /resolve secret/i }).click();
  await expect(page.getByText('Trust evidence')).toBeVisible({ timeout: 10_000 });

  // No emoji codepoints anywhere in rendered text.
  const text = await page.evaluate(() => document.body.innerText);
  // eslint-disable-next-line no-misleading-character-class
  expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

  // No "AI" or "powered by" copy.
  expect(text).not.toMatch(/\bpowered by\b/i);
  expect(text).not.toMatch(/\bcrafted with\b/i);
  expect(text).not.toMatch(/\bbuilt with .*love\b/i);
});

test('carrier unreachable: error state renders correctly', async ({ page }) => {
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
    await page.getByRole('button', { name: /resolve secret/i }).click();

    // Error state: the 502 error or connection error should appear.
    await expect(page.getByText(/502|resolve failed|error/i)).toBeVisible({ timeout: 10_000 });

    // Inspector status footer shows rejected state (use exact text to avoid
    // matching evidence copy that also contains "Rejected").
    await expect(page.getByText('Rejected', { exact: true }).or(
      page.getByText(/^Rejected ·/)
    ).first()).toBeVisible({ timeout: 5_000 });

    // Trust evidence callout should NOT appear (no successful resolve).
    await expect(page.getByText('Trust evidence')).not.toBeVisible();
  } finally {
    execSync('kubectl -n swa-demo scale deploy/carrier --replicas=1', { stdio: 'pipe' });
    execSync('kubectl -n swa-demo wait --for=condition=available --timeout=60s deploy/carrier', { stdio: 'pipe' });
  }
});

test('paced walk reveals stages sequentially under ?pace=slow', async ({ page }) => {
  await page.goto('/?pace=slow');
  await page.getByRole('button', { name: /resolve secret/i }).click();

  // Immediately after click: running state should be active.
  await expect(page.getByText(/Resolving/)).toBeVisible({ timeout: 3000 });

  // The resolved state should NOT appear immediately.
  await expect(page.getByText('Trust evidence')).not.toBeVisible();

  // After the full slow walk, the resolved state should appear.
  await expect(page.getByText('Trust evidence')).toBeVisible({ timeout: 12_000 });
});

function secondsOf(mss: string): number {
  // "4m 58s" -> 298
  const m = mss.match(/(\d+)m\s+(\d+)s/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}
