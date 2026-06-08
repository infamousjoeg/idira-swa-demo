import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// M7 smoke: exercises the foreign-trust-domain rejection path end to end, then
// flips back to INTERNAL and confirms the M3 happy path still works (proves the
// reset-on-toggle wiring did not break the internal flow). Three screenshots
// are saved to out/ for docs/img/ consumption.
//
// SVG IDs reflect what builder-frontend actually shipped: the eyebrow text
// element is #mtls-label (not #mtls-eyebrow) and the connector line is
// #mtls-line (not #mtls-conn). Assertions also key on classes (.eyebrow-rejected,
// .uri-foreign, .stage-skipped) so cosmetic ID drift does not break the smoke.

const OUT_DIR = path.resolve(__dirname, '..', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

test('M7: external mode rejects at trust boundary, internal still works', async ({ page }) => {
  await page.goto('/?pace=off');
  await expect(page.locator('.lockup__mark')).toHaveText('Idira');

  // Selector is present and defaults to internal.
  await expect(page.locator('input[name="carrier"][value="internal"]')).toBeChecked();

  // Flip to EXTERNAL, capture selector screenshot for docs/img/.
  await page.locator('label[for="carrierExternal"]').click();
  await expect(page.locator('input[name="carrier"][value="external"]')).toBeChecked();
  await page.screenshot({ path: path.join(OUT_DIR, 'm7-foreign-td-selector.png'), fullPage: true });

  // Click RESOLVE SECRET with External selected.
  await page.locator('.cta').click();

  // Wait for mtls.peer_uri_seen to land: ACME SAN URI rendered on the right card.
  await expect(page.locator('#carrier-san-1.uri-foreign')).toContainText('spiffe://acme.courier/', { timeout: 5_000 });

  // mTLS connector and eyebrow flipped to the rejected treatment.
  // Assert on the class hook (.eyebrow-rejected on #mtls-label) AND the text
  // content -- robust to ID drift.
  await expect(page.locator('#mtls-label.eyebrow-rejected')).toContainText('UNTRUSTED AUTHORITY');
  await expect(page.locator('#mtls-line.rejected')).toHaveCount(1);

  // TRUST BOUNDARY tile present with non-empty body referencing both the
  // foreign trust domain and federation.
  await expect(page.locator('#tile-boundary')).toBeVisible();
  await expect(page.locator('#tile-boundary')).toContainText('acme.courier');
  await expect(page.locator('#tile-boundary')).toContainText('federation');

  // Downstream stack dimmed.
  for (const id of ['jwt-rect-host', 'sm-rect-host', 'secret-rect-host']) {
    await expect(page.locator(`#${id}.stage-skipped`)).toHaveCount(1);
  }

  // Boundary-teaching copy in the evidence card.
  await expect(page.locator('#evidence')).toContainText('trust domain does not know');

  await page.screenshot({ path: path.join(OUT_DIR, 'm7-foreign-td-rejected.png'), fullPage: true });

  // Flip the ACME card to reveal the foreign cert detail back.
  // We dispatch a synthetic click on the host group directly, rather than
  // page.locator(...).click(), because .stage-rect.foreign in style.css
  // sets only a dashed stroke (no fill) -- the rect's interior has no hit
  // area, only the dashed border. Playwright's center-of-bbox click hits
  // empty space and the SVG root intercepts. The synthetic dispatch fires
  // the click handler (diagram.js:619) on the right element directly.
  // UX nit worth flagging to builder-frontend: an internal-mode .stage-rect--lit
  // has fill: var(--bg-inspector-lift) and is clickable everywhere; the
  // foreign rect is only clickable on its 1px dashed border. The smoke does
  // not depend on click ergonomics, but a human demoer might.
  await page.evaluate(() => {
    document.getElementById('carrier-rect-host')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#carrier-rect-back-fo')).toHaveAttribute('visibility', 'visible', { timeout: 1_000 });
  const backText = await page.locator('#carrier-rect-back-host').innerText();
  expect(backText).toMatch(/ACME/);
  expect(backText).toMatch(/X\.509/);
  expect(backText).toMatch(/REJECTED/i);
  await page.screenshot({ path: path.join(OUT_DIR, 'm7-foreign-td-flipped.png'), fullPage: true });

  // Regression: flip selector back to INTERNAL and confirm the diagram reset
  // (no .foreign class anywhere on the carrier card) plus a clean M3 run.
  await page.locator('label[for="carrierInternal"]').click();
  await expect(page.locator('#carrier-rect.foreign')).toHaveCount(0);
  await expect(page.locator('#mtls-label.eyebrow-rejected')).toHaveCount(0);
  await expect(page.locator('#tile-boundary')).toHaveCount(0);

  await page.locator('.cta').click();
  // M3-style anchor assertion: the internal evidence copy uses 'rotates'.
  await expect(page.locator('#evidence')).toContainText('rotates', { timeout: 5_000 });
});
