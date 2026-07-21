import { test, expect } from '@playwright/test';

test.describe('Health Endpoint', () => {
  test('should return healthy status', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
    expect(data.data).toHaveProperty('status', 'healthy');
    expect(data.data).toHaveProperty('uptime');
    expect(data.data).toHaveProperty('environment');
    expect(data.data).toHaveProperty('timestamp');
  });
});

test.describe('Swagger Documentation', () => {
  test('should redirect root to Swagger UI', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('should serve Swagger UI', async ({ request }) => {
    const response = await request.get('/docs');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

  test('should serve OpenAPI JSON spec', async ({ request }) => {
    const response = await request.get('/openapi.json');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('openapi');
    expect(data).toHaveProperty('info');
    expect(data).toHaveProperty('paths');
    expect(data.servers[0]).toHaveProperty('url', '/');
    expect(data.info).toHaveProperty('title', 'Market Intelligence Browser API');
    expect(data.components.securitySchemes).toHaveProperty('bearerAuth');
  });
});
