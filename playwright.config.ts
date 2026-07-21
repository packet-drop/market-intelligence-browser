import { defineConfig, devices } from '@playwright/test';

const testPort = process.env.TEST_PORT || '3000';
const localBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.API_URL || localBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node dist/index.js',
    url: `${localBaseUrl}/health`,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: testPort,
      SERVICE_API_KEY: process.env.SERVICE_API_KEY || 'e2e-test-service-api-key',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
