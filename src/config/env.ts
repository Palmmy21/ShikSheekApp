/**
 * Environment configuration, validated once at startup. Never log the returned object.
 */
import { z } from 'zod';

const schema = z.object({
  LINE_CHANNEL_SECRET: z.string().min(10, 'LINE_CHANNEL_SECRET is required'),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(20, 'LINE_CHANNEL_ACCESS_TOKEN is required'),
  SUPABASE_DB_URL: z.string().url('SUPABASE_DB_URL must be a postgres URL'),
  SUPABASE_URL: z.string().url().optional(),
  PUBLIC_ASSET_BASE_URL: z.string().url('PUBLIC_ASSET_BASE_URL is required (public URL of the assets bucket)'),
  DATA_EXPORT_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(24, 'CRON_SECRET must be at least 24 characters').optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-haiku-5-5'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(get: (key: string) => string | undefined): AppConfig {
  const raw = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, get(k) || undefined]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration — ${problems}`);
  }
  const cfg = parsed.data;
  if (!cfg.DATA_EXPORT_URL && cfg.SUPABASE_URL) cfg.DATA_EXPORT_URL = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/data-export`;
  return cfg;
}
