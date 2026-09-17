import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run start -- --port 3107',
    url: 'http://127.0.0.1:3107',
    reuseExistingServer: false,
    env: { TOKEN: '', ORG_ID: '', YANDEX_CLIENT_ID: '', YANDEX_CLIENT_SECRET: '' },
  },
});
