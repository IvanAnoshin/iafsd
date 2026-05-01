import { defineConfig } from '@playwright/test';

const baseURL = process.env.FRIENDSCAPE_E2E_BASE_URL || process.env.FRIENDSCAPE_SMOKE_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.FRIENDSCAPE_E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
