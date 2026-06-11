import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// M7 smoke: exercises the foreign-trust-domain rejection path end to end,
// then flips back to INTERNAL and confirms the M3 happy path still works
// (proves the reset-on-toggle wiring did not break the internal flow).
// Updated for the React/Vite portal UI (M-UI redesign).

const OUT_DIR = path.resolve(__dirname, '..', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

test('M7: external mode rejects at trust boundary, internal still works', async ({ page }) => {
  await page.goto('/?pace=off');
  await expect(page.getByText('Praetor Logistics')).toBeVisible();

  // Carrier selector defaults to Internal.
  const internalTab = page.getByRole('tab', { name: 'Internal carrier' });
  await expect(internalTab).toHaveAttribute('aria-selected', 'true');

  // Flip to EXTERNAL.
  const externalTab = page.getByRole('tab', { name: 'External carrier' });
  await externalTab.click();
  await expect(externalTab).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: path.join(OUT_DIR, 'm7-foreign-td-selector.png'), fullPage: true });

  // Click Resolve with External selected.
  await page.getByRole('button', { name: /resolve/i }).click();

  // Wait for the trust boundary evidence callout to appear in the left pane (error path).
  await expect(page.locator('#main-content').getByText('Trust boundary')).toBeVisible({ timeout: 10_000 });

  // mTLS rejection tag visible in the left pane result region.
  await expect(page.getByText('mTLS rejected', { exact: true })).toBeVisible();

  // Topology: trust boundary band present referencing the foreign domain.
  // Use specific text to avoid strict mode violations from multiple matches.
  await expect(page.getByText('acme.courier is outside idira.demo')).toBeVisible();

  // Inspector status footer shows rejected state.
  await expect(page.getByText(/^Rejected · untrusted authority$/)).toBeVisible();

  // Error evidence copy visible in the left pane.
  await expect(page.locator('#main-content').getByText('trust domain', { exact: false }).first()).toBeVisible();

  await page.screenshot({ path: path.join(OUT_DIR, 'm7-foreign-td-rejected.png'), fullPage: true });

  // Regression: flip selector back to INTERNAL and confirm a clean M3 run.
  await internalTab.click();
  await expect(internalTab).toHaveAttribute('aria-selected', 'true');

  // The trust boundary indicators should be gone after reset.
  await expect(page.locator('#main-content').getByText('Trust boundary')).not.toBeVisible();

  // Run a fresh resolve with internal carrier.
  await page.getByRole('button', { name: /resolve/i }).click();

  // The success evidence callout should appear.
  await expect(page.getByText('Trust evidence')).toBeVisible({ timeout: 10_000 });

  // Internal evidence copy uses 'rotates' (the X.509 rotation lifecycle).
  await expect(page.getByText(/short-lived X\.509 certificate/)).toBeVisible();
});
