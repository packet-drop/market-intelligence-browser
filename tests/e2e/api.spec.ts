import { test, expect } from '@playwright/test';

const serviceApiKey = process.env.SERVICE_API_KEY || 'e2e-test-service-api-key';

test.describe('API authentication', () => {
  test('rejects a missing bearer token', async ({ request }) => {
    const response = await request.post('/api/browser/smoke');
    expect(response.status()).toBe(401);
  });

  test('rejects an incorrect bearer token', async ({ request }) => {
    const response = await request.post('/api/browser/smoke', {
      headers: { Authorization: 'Bearer incorrect-key' },
    });
    expect(response.status()).toBe(401);
  });

  test('launches Chromium with a valid bearer token', async ({ request }) => {
    const response = await request.post('/api/browser/smoke', {
      headers: { Authorization: `Bearer ${serviceApiKey}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          browser: 'chromium',
          launched: true,
          headless: true,
        }),
      })
    );
  });
});
