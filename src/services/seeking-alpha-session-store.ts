import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { z } from 'zod';

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('market-intelligence-browser:seeking-alpha-session:v1', 'utf8');

const cookieSchema = z.object({
  name: z.string().max(1024),
  value: z.string().max(16384),
  domain: z.string().max(1024),
  path: z.string().max(4096),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});

const originSchema = z.object({
  origin: z.string().url().max(4096),
  localStorage: z
    .array(z.object({ name: z.string().max(1024), value: z.string().max(65536) }))
    .max(1000),
});

export const storageStateSchema = z
  .object({
    cookies: z.array(cookieSchema).max(1000),
    origins: z.array(originSchema).max(100),
  })
  .strict()
  .superRefine((state, context) => {
    state.cookies.forEach((cookie, index) => {
      if (cookie.domain !== 'seekingalpha.com' && cookie.domain !== '.seekingalpha.com') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cookies', index, 'domain'],
          message: 'must be scoped to Seeking Alpha',
        });
      }
    });
    state.origins.forEach((origin, index) => {
      if (origin.origin !== 'https://seekingalpha.com') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['origins', index, 'origin'],
          message: 'must be the approved Seeking Alpha origin',
        });
      }
    });
  });

export type PlaywrightStorageState = z.infer<typeof storageStateSchema>;

export interface StoredSession {
  storageState: PlaywrightStorageState;
  importedAt: string;
  lastVerifiedAt?: string;
}

const storedSessionSchema = z.object({
  storageState: storageStateSchema,
  importedAt: z.string().datetime(),
  lastVerifiedAt: z.string().datetime().optional(),
});

const envelopeSchema = z
  .object({
    version: z.literal(ENVELOPE_VERSION),
    algorithm: z.literal(ALGORITHM),
    iv: z.string(),
    authTag: z.string(),
    ciphertext: z.string(),
  })
  .strict();

export class SessionPersistenceError extends Error {
  constructor(message = 'Seeking Alpha session persistence failed') {
    super(message);
    this.name = 'SessionPersistenceError';
  }
}

export class SeekingAlphaSessionStore {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly filePath: string,
    encryptionKeyBase64: string
  ) {
    this.encryptionKey = Buffer.from(encryptionKeyBase64, 'base64');
    if (this.encryptionKey.length !== 32) {
      throw new SessionPersistenceError('Session encryption key must contain 32 bytes');
    }
  }

  async verifyWritable(): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.access(directory, fsConstants.W_OK);

    const probePath = path.join(
      directory,
      `.session-write-probe-${process.pid}-${randomBytes(8).toString('hex')}`
    );
    const probe = await fs.open(probePath, 'wx', 0o600);
    await probe.close();
    await fs.unlink(probePath);
  }

  async load(): Promise<StoredSession | null> {
    let serialized: string;
    try {
      serialized = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new SessionPersistenceError();
    }

    try {
      const envelope = envelopeSchema.parse(JSON.parse(serialized));
      const decipher = createDecipheriv(
        ALGORITHM,
        this.encryptionKey,
        Buffer.from(envelope.iv, 'base64')
      );
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return storedSessionSchema.parse(JSON.parse(plaintext.toString('utf8')));
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async save(session: StoredSession): Promise<void> {
    const validated = storedSessionSchema.parse(session);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(validated), 'utf8'),
      cipher.final(),
    ]);
    const envelope = {
      version: ENVELOPE_VERSION,
      algorithm: ALGORITHM,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };

    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;

    try {
      await fs.writeFile(temporaryPath, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw new SessionPersistenceError();
    }
  }
}
