// portal-ui.spec.ts -- visual regression suite for the 8 canonical UI states.
// Captures screenshots across 4 states (idle, done, error, idle-ext) and
// 3 inspector visualizations (topology, layers, trace) for full coverage.
// First run generates baselines; subsequent runs diff at 0.02 threshold.
import { test, expect } from '@playwright/test';

// Resolve with pace=off so events fire immediately and we can capture
// the terminal state without timing-dependent waits.
const BASE = '/?pace=off';

// Wait for the trust-context bar to populate (proves the page rendered).
async function waitForChrome(page: import('@playwright/test').Page) {
  await page.waitForSelector('text=idira.demo', { timeout: 10_000 });
}

// Drive a resolve by clicking the Resolve button and waiting for terminal state.
async function resolveAndWait(
  page: import('@playwright/test').Page,
  carrier: 'internal' | 'external',
) {
  // Select the carrier tab if needed.
  const tabLabel = carrier === 'external' ? 'External carrier' : 'Internal carrier';
  await page.getByRole('tab', { name: tabLabel }).click();

  // Click Resolve button.
  await page.getByRole('button', { name: /resolve/i }).click();

  if (carrier === 'internal') {
    // Wait for the success evidence callout to appear.
    await page.waitForSelector('text=Trust evidence', { timeout: 15_000 });
  } else {
    // Wait for the error evidence callout to appear.
    await page.waitForSelector('text=Trust boundary', { timeout: 15_000 });
  }

  // Small settle delay for animations to complete.
  await page.waitForTimeout(800);
}

// Switch the inspector view via the DarkSeg control.
async function switchView(page: import('@playwright/test').Page, view: string) {
  await page.getByRole('button', { name: view }).click();
  await page.waitForTimeout(300);
}

// Reset via the Reset button or ESC key.
async function resetEngine(page: import('@playwright/test').Page) {
  const resetBtn = page.getByRole('button', { name: /reset/i });
  if (await resetBtn.isVisible()) {
    await resetBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
}

// ---- 1. Idle states ----

test('idle-internal-topology', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot('idle-internal-topology.png');
});

test('idle-external-topology', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await page.getByRole('tab', { name: 'External carrier' }).click();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot('idle-external-topology.png');
});

// ---- 2. Done states (internal carrier, 3 views) ----

test('done-internal-topology', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'internal');
  await expect(page).toHaveScreenshot('done-internal-topology.png');
});

test('done-internal-layers', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'internal');
  await switchView(page, 'Layers');
  await expect(page).toHaveScreenshot('done-internal-layers.png');
});

test('done-internal-trace', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'internal');
  await switchView(page, 'Trace');
  await expect(page).toHaveScreenshot('done-internal-trace.png');
});

// ---- 3. Error states (external carrier, 3 views) ----

test('error-external-topology', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'external');
  await expect(page).toHaveScreenshot('error-external-topology.png');
});

test('error-external-layers', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'external');
  await switchView(page, 'Layers');
  await expect(page).toHaveScreenshot('error-external-layers.png');
});

test('error-external-trace', async ({ page }) => {
  await page.goto(BASE);
  await waitForChrome(page);
  await resolveAndWait(page, 'external');
  await switchView(page, 'Trace');
  await expect(page).toHaveScreenshot('error-external-trace.png');
});
