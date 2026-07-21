import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    CORS_ORIGIN: z.string().default('*'),
    SERVICE_API_KEY: z.string().min(1).optional(),
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
