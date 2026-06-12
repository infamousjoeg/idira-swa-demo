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
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-1080p',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
    // 2560x1440 projector project skipped: adds ~15s for 8 extra baselines.
    // Joe's primary demo display is 1920x1080; projector captures can be
    // added later if needed.
  ],
});
