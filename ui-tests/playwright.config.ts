import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  reporter: [['list']],
  timeout: 30_000,
  // Sequential execution: smoke tests modify cluster state (carrier scale).
  workers: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  snapshotPathTemplate: '{testDir}/screenshots/baseline/{arg}{ext}',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:18080',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
