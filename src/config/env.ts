import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().optional(),
  DEFAULT_LINK_EXPIRY_HOURS: z.string().default('24'),
  LINK_CREATION_RATE_LIMIT_WINDOW_MIN: z.string().default('15'),
  LINK_CREATION_RATE_LIMIT_MAX: z.string().default('10'),
  ADMIN_LOGIN_RATE_LIMIT_WINDOW_MIN: z.string().default('15'),
  ADMIN_LOGIN_RATE_LIMIT_MAX: z.string().default('5'),
  ALLOW_PUBLIC_LINK_CREATION: z.string().default('true'),
  REQUIRE_INTERSTITIAL_FOR_SUSPECT_UA: z.string().default('true'),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Environment validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  env = result.data;
  return env;
}

export function getEnv(): Env {
  if (!env) {
    return loadEnv();
  }
  return env;
}
