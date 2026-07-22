import http, { Server } from 'http';
import { AddressInfo } from 'net';

jest.mock('./services/browser.service', () => ({
  browserService: {
    runSmokeCheck: jest.fn(),
    close: jest.fn(),
  },
}));

jest.mock('./services/seeking-alpha-session.service', () => ({
  seekingAlphaSessionService: {
    initialize: jest.fn(),
    checkSession: jest.fn(),
    importSession: jest.fn(),
  },
}));

jest.mock('./services/seeking-alpha-quant.service', () => {
  const actual = jest.requireActual('./services/seeking-alpha-quant.service');
  return {
    ...actual,
    seekingAlphaQuantService: { lookup: jest.fn() },
  };
});

import { createApp } from './app';
import env from './config/env';
import { browserService } from './services/browser.service';
import { seekingAlphaQuantService } from './services/seeking-alpha-quant.service';
import { SeekingAlphaOperationError } from './services/seeking-alpha-operation-error';
import { seekingAlphaSessionService } from './services/seeking-alpha-session.service';

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
  const checkSession = seekingAlphaSessionService.checkSession as jest.MockedFunction<
    typeof seekingAlphaSessionService.checkSession
  >;
  const importSession = seekingAlphaSessionService.importSession as jest.MockedFunction<
    typeof seekingAlphaSessionService.importSession
  >;
  const lookupQuantRating = seekingAlphaQuantService.lookup as jest.MockedFunction<
    typeof seekingAlphaQuantService.lookup
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
    checkSession.mockReset();
    importSession.mockReset();
    lookupQuantRating.mockReset();
    env.SEEKING_ALPHA_SESSION_IMPORT_ENABLED = false;
    env.SEEKING_ALPHA_SESSION_ADMIN_KEY = undefined;
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

  test('protects the Seeking Alpha session check with the service bearer token', async () => {
    checkSession.mockResolvedValue({
      state: 'MISSING',
      checkedAt: '2026-07-21T00:00:00.000Z',
      reason: 'SESSION_FILE_MISSING',
    });

    const unauthorized = await request('/api/sources/seeking-alpha/session/check', {
      method: 'POST',
    });
    const authorized = await request('/api/sources/seeking-alpha/session/check', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ state: 'MISSING' }),
      })
    );
    expect(checkSession).toHaveBeenCalledTimes(1);
  });

  test('uses a separate admin bearer and kill switch for session import', async () => {
    const storageState = { cookies: [], origins: [] };
    const disabled = await request('/api/admin/sources/seeking-alpha/session/import', {
      method: 'POST',
      authorization: 'Bearer test-admin-key',
      body: storageState,
    });
    expect(disabled.statusCode).toBe(404);

    env.SEEKING_ALPHA_SESSION_IMPORT_ENABLED = true;
    env.SEEKING_ALPHA_SESSION_ADMIN_KEY = 'test-admin-key';
    importSession.mockResolvedValue({ importedAt: '2026-07-21T00:00:00.000Z' });

    const wrongBoundary = await request('/api/admin/sources/seeking-alpha/session/import', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
      body: storageState,
    });
    const imported = await request('/api/admin/sources/seeking-alpha/session/import', {
      method: 'POST',
      authorization: 'Bearer test-admin-key',
      body: storageState,
    });

    expect(wrongBoundary.statusCode).toBe(401);
    expect(imported.statusCode).toBe(201);
    expect(importSession).toHaveBeenCalledWith(storageState);
  });

  test('protects and normalizes the ticker-based Quant Rating lookup', async () => {
    lookupQuantRating.mockResolvedValue({
      ticker: 'BRK.B',
      rating: 'BUY',
      score: 4.25,
      observedPrice: 512.34,
      canonicalPath: '/symbol/BRK.B/ratings/quant-ratings',
      observedAt: '2026-07-22T00:00:00.000Z',
    });

    const unauthorized = await request('/api/sources/seeking-alpha/quant-ratings/lookup', {
      method: 'POST',
      body: { ticker: 'BRK.B' },
    });
    const invalid = await request('/api/sources/seeking-alpha/quant-ratings/lookup', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
      body: { ticker: '../account/login' },
    });
    const authorized = await request('/api/sources/seeking-alpha/quant-ratings/lookup', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
      body: { ticker: ' brk.b ' },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toEqual(
      expect.objectContaining({ success: false, code: 'INVALID_TICKER' })
    );
    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toEqual(
      expect.objectContaining({ success: true, data: expect.objectContaining({ ticker: 'BRK.B' }) })
    );
    expect(lookupQuantRating).toHaveBeenCalledTimes(1);
    expect(lookupQuantRating).toHaveBeenCalledWith('BRK.B');
  });

  test('returns bounded Quant lookup error codes without upstream details', async () => {
    lookupQuantRating.mockRejectedValue(new SeekingAlphaOperationError('SESSION_EXPIRED'));

    const response = await request('/api/sources/seeking-alpha/quant-ratings/lookup', {
      method: 'POST',
      authorization: 'Bearer test-service-api-key',
      body: { ticker: 'AAPL' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: 'Seeking Alpha session has expired',
        code: 'SESSION_EXPIRED',
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('seekingalpha.com');
  });
});
