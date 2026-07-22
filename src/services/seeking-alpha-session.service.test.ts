jest.mock('playwright', () => ({
  chromium: { launch: jest.fn() },
}));

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { SeekingAlphaSessionService } from './seeking-alpha-session.service';
import { SeekingAlphaSessionStore } from './seeking-alpha-session-store';
import { SerializedOperationQueue } from './serialized-operation-queue';

const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const storageState = { cookies: [], origins: [] };

describe('SeekingAlphaSessionService', () => {
  let directory: string;
  let store: SeekingAlphaSessionStore;

  beforeEach(async () => {
    jest.resetAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mi-session-service-'));
    store = new SeekingAlphaSessionStore(path.join(directory, 'session.enc'), encryptionKey);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('reports a missing session without launching Chromium', async () => {
    const service = new SeekingAlphaSessionService(
      store,
      true,
      new SerializedOperationQueue(10, 0)
    );

    await expect(service.checkSession()).resolves.toEqual(
      expect.objectContaining({ state: 'MISSING', reason: 'SESSION_FILE_MISSING' })
    );
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  test('verifies in an isolated context and persists refreshed state', async () => {
    await store.save({ storageState, importedAt: '2026-07-21T00:00:00.000Z' });
    const mainFrame = {};
    const closeContext = jest.fn().mockResolvedValue(undefined);
    const closeBrowser = jest.fn().mockResolvedValue(undefined);
    const page = {
      route: jest.fn().mockResolvedValue(undefined),
      mainFrame: jest.fn().mockReturnValue(mainFrame),
      goto: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue('https://seekingalpha.com/account/edit_price_alerts?tab=history'),
      title: jest.fn().mockResolvedValue('Price Alerts'),
      locator: jest.fn((selector: string) =>
        selector === 'body'
          ? { innerText: jest.fn().mockResolvedValue('Alert history') }
          : { count: jest.fn().mockResolvedValue(0) }
      ),
    };
    const context = {
      newPage: jest.fn().mockResolvedValue(page),
      storageState: jest.fn().mockResolvedValue(storageState),
      close: closeContext,
    };
    const newContext = jest.fn().mockResolvedValue(context);
    (chromium.launch as jest.Mock).mockResolvedValue({
      newContext,
      close: closeBrowser,
    });

    const service = new SeekingAlphaSessionService(
      store,
      true,
      new SerializedOperationQueue(10, 0)
    );
    const checked = await service.checkSession();

    expect(checked).toEqual(
      expect.objectContaining({
        state: 'VALID',
        importedAt: '2026-07-21T00:00:00.000Z',
        lastVerifiedAt: expect.any(String),
      })
    );
    expect(newContext).toHaveBeenCalledWith({ storageState });
    expect(page.goto).toHaveBeenCalledWith(
      'https://seekingalpha.com/account/edit_price_alerts?tab=history',
      expect.objectContaining({ waitUntil: 'domcontentloaded' })
    );
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    await expect(store.load()).resolves.toEqual(
      expect.objectContaining({ lastVerifiedAt: checked.lastVerifiedAt })
    );
  });

  test('preserves non-sensitive session timestamps when login is required', async () => {
    await store.save({
      storageState,
      importedAt: '2026-07-21T00:00:00.000Z',
      lastVerifiedAt: '2026-07-21T12:00:00.000Z',
    });
    const page = {
      route: jest.fn().mockResolvedValue(undefined),
      mainFrame: jest.fn().mockReturnValue({}),
      goto: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://seekingalpha.com/account/login'),
    };
    const context = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (chromium.launch as jest.Mock).mockResolvedValue({
      newContext: jest.fn().mockResolvedValue(context),
      close: jest.fn().mockResolvedValue(undefined),
    });
    const service = new SeekingAlphaSessionService(
      store,
      true,
      new SerializedOperationQueue(10, 0)
    );

    await expect(service.checkSession()).resolves.toEqual(
      expect.objectContaining({
        state: 'EXPIRED',
        reason: 'LOGIN_REQUIRED',
        importedAt: '2026-07-21T00:00:00.000Z',
        lastVerifiedAt: '2026-07-21T12:00:00.000Z',
      })
    );
  });

  test('recognizes the in-page Press & Hold challenge without relying on a redirect', async () => {
    await store.save({ storageState, importedAt: '2026-07-21T00:00:00.000Z' });
    const page = {
      route: jest.fn().mockResolvedValue(undefined),
      mainFrame: jest.fn().mockReturnValue({}),
      goto: jest.fn().mockResolvedValue(undefined),
      url: jest
        .fn()
        .mockReturnValue('https://seekingalpha.com/account/edit_price_alerts?tab=history'),
      title: jest.fn().mockResolvedValue('Price Alerts'),
      locator: jest.fn((selector: string) =>
        selector === 'body'
          ? {
              innerText: jest
                .fn()
                .mockResolvedValue('PRESS & HOLD\nPlease enable JavaScript and cookies.'),
            }
          : { count: jest.fn().mockResolvedValue(0) }
      ),
    };
    const context = {
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (chromium.launch as jest.Mock).mockResolvedValue({
      newContext: jest.fn().mockResolvedValue(context),
      close: jest.fn().mockResolvedValue(undefined),
    });
    const service = new SeekingAlphaSessionService(
      store,
      true,
      new SerializedOperationQueue(10, 0)
    );

    await expect(service.checkSession()).resolves.toEqual(
      expect.objectContaining({ state: 'CHALLENGE_REQUIRED', reason: 'UPSTREAM_CHALLENGE' })
    );
  });

  test('normalizes browser failures without returning sensitive error details', async () => {
    (chromium.launch as jest.Mock).mockRejectedValue(
      new Error('navigation failed with cookie=do-not-return')
    );
    await store.save({ storageState, importedAt: '2026-07-21T00:00:00.000Z' });
    const service = new SeekingAlphaSessionService(
      store,
      true,
      new SerializedOperationQueue(10, 0)
    );

    const checked = await service.checkSession();
    expect(checked).toEqual(
      expect.objectContaining({ state: 'UNAVAILABLE', reason: 'UPSTREAM_UNAVAILABLE' })
    );
    expect(JSON.stringify(checked)).not.toContain('do-not-return');
  });
});
