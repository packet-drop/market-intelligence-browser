import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { SeekingAlphaSessionStore, SessionPersistenceError } from './seeking-alpha-session-store';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const storageState = {
  cookies: [
    {
      name: 'secret-cookie',
      value: 'plaintext-must-not-appear',
      domain: '.seekingalpha.com',
      path: '/',
      expires: 1999999999,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
};

describe('SeekingAlphaSessionStore', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mi-session-store-'));
    filePath = path.join(directory, 'session.enc');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('encrypts storage state before writing and can decrypt it', async () => {
    const store = new SeekingAlphaSessionStore(filePath, encryptionKey);
    const session = {
      storageState,
      importedAt: '2026-07-21T00:00:00.000Z',
      lastVerifiedAt: '2026-07-21T01:00:00.000Z',
    };

    await store.verifyWritable();
    await store.save(session);

    const persisted = await fs.readFile(filePath, 'utf8');
    expect(persisted).not.toContain('secret-cookie');
    expect(persisted).not.toContain('plaintext-must-not-appear');
    expect(JSON.parse(persisted)).toEqual(
      expect.objectContaining({ version: 1, algorithm: 'aes-256-gcm' })
    );
    await expect(store.load()).resolves.toEqual(session);

    const refreshed = { ...session, lastVerifiedAt: '2026-07-21T02:00:00.000Z' };
    await store.save(refreshed);
    await expect(store.load()).resolves.toEqual(refreshed);
  });

  test('rejects a tampered encrypted envelope without exposing its contents', async () => {
    const store = new SeekingAlphaSessionStore(filePath, encryptionKey);
    await store.save({ storageState, importedAt: '2026-07-21T00:00:00.000Z' });
    const envelope = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      ciphertext: string;
    };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    await fs.writeFile(filePath, JSON.stringify(envelope));

    await expect(store.load()).rejects.toEqual(
      new SessionPersistenceError('Seeking Alpha session persistence failed')
    );
  });

  test('returns null when no persisted session exists', async () => {
    const store = new SeekingAlphaSessionStore(filePath, encryptionKey);
    await expect(store.load()).resolves.toBeNull();
  });

  test('rejects cookies and origin storage outside Seeking Alpha', async () => {
    const store = new SeekingAlphaSessionStore(filePath, encryptionKey);
    const thirdPartyState = {
      cookies: [{ ...storageState.cookies[0], domain: '.example.com' }],
      origins: [],
    };

    await expect(
      store.save({
        storageState: thirdPartyState,
        importedAt: '2026-07-21T00:00:00.000Z',
      })
    ).rejects.toThrow('must be scoped to Seeking Alpha');
  });
});
