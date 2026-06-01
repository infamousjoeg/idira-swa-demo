// readme-shots.mjs — capture the three README images at known viewport sizes.
//
// Prerequisites:
//   - kubectl port-forward svc/portal 18080:8080 (the Makefile target arranges this)
//   - The portal Deployment has the current M5 UI (build-apps + deploy-apps).
//
// Output: docs/img/portal-empty.png, portal-walking.png, portal-resolved.png,
//         portal-flipped-jwt.png             (M6: JWT card flipped, at rest),
//         portal-flipped-jwt-scrolled.png    (M6 post-Whisper-Rail: JWT mid-scroll, ghost rail visible),
//         portal-flipped-sm-scrolled.png     (M6 post-Whisper-Rail: SM scrolled to bottom, rail visible),
//         portal-flipped-portal-cert.png     (M6 post-Whisper-Rail: portal X.509 hovered at scroll-top)

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

  // 5) JWT-SVID back mid-scroll with Whisper Rail thumb visible.
  //    Whisper Rail is ambient at rest and surfaces only on .card-back:hover
  //    (220ms scrollbar-color transition). page.hover triggers the hover
  //    state; the 280ms wait lets the transition complete before screenshot.
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
  await page.waitForTimeout(300);  // scale-flip settle
  // Scroll the JWT back to roughly the middle so the JOSE header / raw JWT are
  // visible AND the scroll thumb sits at mid-rail (not pinned to top).
  // The host wrapper is 100%x100% (non-scrolling); the actual scrollable
  // element is the .card-back child whose overflow: auto produced the rail.
  await page.evaluate(() => {
    const host = document.getElementById('jwt-rect-back-host');
    const back = host?.querySelector('.card-back');
    if (back) back.scrollTop = Math.floor(back.scrollHeight / 2);
  });
  // Hover the card host to make the Whisper Rail ghost (--idira-750) appear.
  await page.hover('#jwt-rect-host');
  await page.waitForTimeout(280);  // outlast the 220ms scrollbar-color transition
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-flipped-jwt-scrolled.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-flipped-jwt-scrolled.png'));

  // 6) SM-token back scrolled to bottom (bearer/TTL/scope visible) with
  //    Whisper Rail thumb at bottom of rail. SM card is 60h with ~220px of
  //    content -- the most-overflowing card, best demo of the scrollbar.
  await page.goto(`${BASE}/?pace=off`);
  await page.waitForSelector('#diagram svg');
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await page.waitForSelector('#evidence:not([hidden])', { timeout: 5000 });
  await page.click('#sm-rect-host');
  await page.waitForFunction(() =>
    document.getElementById('sm-rect-back-fo')?.getAttribute('visibility') === 'visible',
    { timeout: 1500 });
  await page.waitForTimeout(300);
  // Scroll SM back fully to bottom so the bearer/TTL/scope rows are visible.
  // Scroll the .card-back child (the host wrapper itself does not scroll).
  await page.evaluate(() => {
    const host = document.getElementById('sm-rect-back-host');
    const back = host?.querySelector('.card-back');
    if (back) back.scrollTop = back.scrollHeight;
  });
  await page.hover('#sm-rect-host');
  await page.waitForTimeout(280);
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-flipped-sm-scrolled.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-flipped-sm-scrolled.png'));

  // 7) Portal X.509 back hovered at scroll-top with Whisper Rail thumb at
  //    top of rail. Demonstrates the at-top scroll position (different
  //    thumb location than capture #6 for visual contrast).
  await page.goto(`${BASE}/?pace=off`);
  await page.waitForSelector('#diagram svg');
  await page.waitForFunction(() => {
    const v = document.getElementById('td-val')?.textContent || '';
    return v && v !== '—';
  }, { timeout: 10000 });
  await page.fill('input[name="shipment_id"]', 'SHP-2049-883');
  await page.click('button.cta');
  await page.waitForSelector('#portal-rect.stage-rect--lit', { timeout: 5000 });
  await page.click('#portal-rect-host');
  await page.waitForFunction(() =>
    document.getElementById('portal-rect-back-fo')?.getAttribute('visibility') === 'visible',
    { timeout: 1500 });
  await page.waitForTimeout(300);
  // Stay at scrollTop = 0 (default after flip).
  await page.hover('#portal-rect-host');
  await page.waitForTimeout(280);
  await page.screenshot({ path: resolve(OUT_DIR, 'portal-flipped-portal-cert.png'), fullPage: true });
  console.log('wrote', resolve(OUT_DIR, 'portal-flipped-portal-cert.png'));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
