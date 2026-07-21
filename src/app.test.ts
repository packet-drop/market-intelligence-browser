import http, { Server } from 'http';
import { AddressInfo } from 'net';

jest.mock('./services/browser.service', () => ({
  browserService: {
    runSmokeCheck: jest.fn(),
    close: jest.fn(),
  },
}));

import { createApp } from './app';
import { browserService } from './services/browser.service';

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

describe('service API foundation', () => {
  let server: Server;
  let port: number;
  const runSmokeCheck = browserService.runSmokeCheck as jest.MockedFunction<
    typeof browserService.runSmokeCheck
  >;

  beforeAll((done) => {
    server = createApp().listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    runSmokeCheck.mockReset();
  });

  const request = (
    path: string,
    options: { method?: string; authorization?: string; body?: unknown } = {}
  ): Promise<TestResponse> =>
    new Promise((resolve, reject) => {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      const headers: Record<string, string | number> = {};

      if (options.authorization) headers.Authorization = options.authorization;
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method ?? 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: rawBody ? JSON.parse(rawBody) : undefined,
            });
          });
        }
      );

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  test('keeps GET /health public', async () => {
    const response = await request('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'healthy' }),
      })
    );
  });

  test('rejects a missing bearer token', async () => {
    const response = await request('/api/browser/smoke', { method: 'POST' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toEqual(
      expect.objectContaining({ success: false, error: 'Unauthorized' })
    );
    expect(runSmokeCheck).not.toHaveBeenCalled();
  });

  test('rejects an incorrect bearer token', async () => {
    const response = await request('/api/browser/smoke', {
      method: 'POST',
      authorization: 'Bearer incorrect-key',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual(
      expect.objectContaining({ success: false, error: 'Unauthorized' })
    );
    expect(runSmokeCheck).not.toHaveBeenCalled();
  });

  test('accepts a valid bearer token and runs the browser smoke check', async () => {
    runSmokeCheck.mockResolvedValue({
      browser: 'chromium',
      launched: true,
      headless: true,
      version: 'test-version',
    });

    const response = await request('/api/browser/smoke', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
      body: { url: 'https://example.com/ignored' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: {
          browser: 'chromium',
          launched: true,
          headless: true,
          version: 'test-version',
        },
      })
    );
    expect(runSmokeCheck).toHaveBeenCalledTimes(1);
    expect(runSmokeCheck).toHaveBeenCalledWith();
  });
});
