import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    CORS_ORIGIN: z.string().default('*'),
    SERVICE_API_KEY: z.string().min(1).optional(),
    SEEKING_ALPHA_ENABLED: z
      .string()
      .transform((v) => v === 'true' || v === '1')
      .default('false'),
    SEEKING_ALPHA_SESSION_PATH: z.string().min(1).default('/data/seeking-alpha-session.enc'),
    SEEKING_ALPHA_SESSION_ENCRYPTION_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional()
    ),
    SEEKING_ALPHA_SESSION_ADMIN_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional()
    ),
    SEEKING_ALPHA_SESSION_IMPORT_ENABLED: z
      .string()
      .transform((v) => v === 'true' || v === '1')
      .default('false'),
    SEEKING_ALPHA_MAX_QUEUE_SIZE: z.coerce.number().int().min(0).max(100).default(10),
    SEEKING_ALPHA_MIN_NAVIGATION_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
    SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    PLAYWRIGHT_HEADLESS: z
      .string()
      .transform((v) => v === 'true' || v === '1')
      .default('true'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
    RATE_LIMIT_MAX: z.coerce.number().default(60),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production' && !values.SERVICE_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SERVICE_API_KEY'],
        message: 'SERVICE_API_KEY is required when NODE_ENV=production',
      });
    }

    if (values.SEEKING_ALPHA_ENABLED || values.SEEKING_ALPHA_SESSION_IMPORT_ENABLED) {
      if (!values.SEEKING_ALPHA_SESSION_ENCRYPTION_KEY) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEEKING_ALPHA_SESSION_ENCRYPTION_KEY'],
          message: 'is required when Seeking Alpha session support is enabled',
        });
      } else if (!/^[A-Za-z0-9+/]{43}=$/.test(values.SEEKING_ALPHA_SESSION_ENCRYPTION_KEY)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEEKING_ALPHA_SESSION_ENCRYPTION_KEY'],
          message: 'must be a base64-encoded 32-byte key',
        });
      }
    }

    if (values.SEEKING_ALPHA_SESSION_IMPORT_ENABLED && !values.SEEKING_ALPHA_SESSION_ADMIN_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEEKING_ALPHA_SESSION_ADMIN_KEY'],
        message: 'is required when session import is enabled',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const messages = parsedEnv.error.errors
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');

  throw new Error(`Environment validation failed: ${messages}`);
}

export default parsedEnv.data;
