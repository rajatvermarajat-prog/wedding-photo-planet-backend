import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
}

/** Vercel/dashboard often stores unused keys as "". Zod defaults only apply to undefined. */
function withoutBlanks(input: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() === ''
        ? undefined
        : typeof value === 'string'
          ? value.trim().replace(/^["']|["']$/g, '')
          : value,
    ]),
  );
}

const bool = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

const int = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const onVercel = Boolean(process.env.VERCEL);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default(onVercel ? 'production' : 'development'),
  PORT: int(5000),
  API_BASE_PATH: z.string().startsWith('/').default('/api/v1'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a PostgreSQL connection string. This service does not support any other engine.',
    ),
  TEST_DATABASE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: bool(onVercel || process.env.NODE_ENV === 'production' ? 'true' : 'false'),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGIN: z
    .string()
    .default(onVercel ? 'https://wedding-photo-planet.vercel.app' : 'http://localhost:3000'),

  RATE_LIMIT_WINDOW_MS: int(15 * 60 * 1000),
  RATE_LIMIT_MAX: int(300),
  AUTH_RATE_LIMIT_MAX: int(10),

  JSON_BODY_LIMIT: z.string().default('1mb'),
  MAX_PAGE_SIZE: int(100),
  DEFAULT_PAGE_SIZE: int(25),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  STORAGE_PROVIDER: z.enum(['LOCAL', 'S3', 'R2', 'SUPABASE']).default('LOCAL'),
  STORAGE_BUCKET: z.string().default('wedding-photo-planet'),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  SIGNED_URL_TTL_SECONDS: int(900),

  SEED_ORG_NAME: z.string().default('Wedding Photo Planet'),
  SEED_ORG_SLUG: z.string().default('wedding-photo-planet'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMe@Admin2026'),
  SEED_DEMO_DATA: bool('false'),
});

const parsed = schema.safeParse(withoutBlanks(process.env));

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Fail fast and loudly: a mis-configured process must never start and serve
  // traffic against the wrong database or with a weak signing key.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const raw = parsed.data;
if (onVercel && !/sslmode=/i.test(raw.DATABASE_URL)) {
  raw.DATABASE_URL += `${raw.DATABASE_URL.includes('?') ? '&' : '?'}sslmode=require`;
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  /** Strict CORS allowlist. No wildcard is ever honoured. */
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

export type Env = typeof env;
