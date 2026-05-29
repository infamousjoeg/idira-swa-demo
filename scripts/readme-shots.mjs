// readme-shots.mjs — capture the three README images at known viewport sizes.
//
// Prerequisites:
//   - kubectl port-forward svc/portal 18080:8080 (the Makefile target arranges this)
//   - The portal Deployment has the current M5 UI (build-apps + deploy-apps).
//
// Output: docs/img/portal-empty.png, portal-walking.png, portal-resolved.png,
//         portal-flipped-jwt.png (M6: JWT-SVID hero card flipped open)

import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve playwright from the current working directory (ui-tests/) rather than
// from the script's location. The Makefile cd's into ui-tests before invoking
// this so the bundled @playwright/test install is reused without a duplicate
// node_modules under scripts/.
const playwrightURL = pathToFileURL(resolve('node_modules/playwright/index.mjs')).href;
const { chromium } = await import(playwrightURL);

// Resolve docs/img relative to the repo root (this file lives in scripts/).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VIEWPORT = { width: 1440, height: 900 };
const OUT_DIR = resolve(REPO_ROOT, 'docs/img');
const BASE = 'http://localhost:18080';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  // 1) Empty / idle state — defaults to Medium pacing but no walk in flight.
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#diagram svg', { state: 'visible' });
  // Wait for /identity fetch to populate hierarchy ribbon.
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-empty.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-empty.png'));

  // 2) Mid-walk: ?pace=slow + click + screenshot ~1s in (after portal lit,
  //    before secret-rect). CTA reads SKIP at this point.
  await page.goto(`${BASE}/?pace=slow`);
  await page.waitForSelector('#diagram svg');
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  // Wait until the portal card lights (first stage) so the SKIP CTA is visible
  // and the diagram is in mid-walk. We do NOT wait further -- if we wait for
  // carrier-rect.lit the slow-pace timing places us near the climax already.
  await page.waitForSelector('#portal-rect.stage-rect--lit', { timeout: 5000 });
  // Tiny settle: ~one stage tick at slow pace puts mTLS in flight without the
  // JWT hero having fired yet.
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-walking.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-walking.png'));

  // 3) Resolved state: ?pace=off + click + wait for evidence card.
  await page.goto(`${BASE}/?pace=off`);
  await page.waitForSelector('#diagram svg');
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await page.waitForSelector('#evidence:not([hidden])', { timeout: 5000 });
  // Wait for the TTL ticker to populate the evidence-ttl span (fires once per
  // second). 1100ms guarantees at least one tick has fired.
  await page.waitForTimeout(1100);
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-resolved.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-resolved.png'));

  // 4) Flipped JWT-SVID hero: resolve + click the JWT card. Spec M6 §10.
  await page.goto(`${BASE}/?pace=off`);
  await page.waitForSelector('#diagram svg');
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await page.waitForSelector('#jwt-rect.stage-rect--hero', { timeout: 5000 });
  await page.click('#jwt-rect-host');
  await page.waitForFunction(() =>
    document.getElementById('jwt-rect-back-fo')?.getAttribute('visibility') === 'visible',
    { timeout: 1500 });
  await page.waitForTimeout(300);  // let the 250ms scale-flip settle
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-flipped-jwt.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-flipped-jwt.png'));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
