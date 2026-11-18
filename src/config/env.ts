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
  /** LINE Login channel that owns the LIFF app (ID token audience). */
  LINE_LOGIN_CHANNEL_ID: z.string().regex(/^\d{6,12}$/).optional(),
  /** Comma-separated origins allowed to call the API (the LIFF site). */
  API_ALLOWED_ORIGINS: z.string().default('https://shiksheek.vercel.app'),
  /** https://liff.line.me/<liff-id> — linked from bot cards. */
  LIFF_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /** anthropic | openrouter. Default: whichever key is set (OpenRouter wins if both). */
  AI_PROVIDER: z.enum(['anthropic', 'openrouter']).optional(),
  /** Model id for the chosen provider. Defaults: claude-opus-5-5 (Anthropic) / anthropic/claude-opus-5.5 (OpenRouter). */
  AI_MODEL: z.string().optional(),
  /** 'true' = AI also writes the mascot's one-liners (adds latency to every reply). */
  AI_PERSONALITY: z.enum(['true', 'false']).default('false'),
  /** 2C2P PGW v4.5 merchant credentials. Both set → in-chat PromptPay checkout is enabled. */
  TWOC2P_MERCHANT_ID: z.string().min(1).optional(),
  TWOC2P_SECRET_KEY: z.string().min(16).optional(),
  TWOC2P_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  /** Comma-separated 2C2P paymentChannel codes for the hosted page (PromptPay / Thai QR). */
  TWOC2P_CHANNELS: z.string().default('QR'),
  /** Thank-you page 2C2P redirects to after paying. */
  PAYMENT_RETURN_URL: z.string().url().default('https://shiksheek.vercel.app/paid'),
  /** Public URL of the payment-webhook function (defaults from SUPABASE_URL). */
  PAYMENT_NOTIFY_URL: z.string().url().optional(),
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
  if (!cfg.PAYMENT_NOTIFY_URL && cfg.SUPABASE_URL) cfg.PAYMENT_NOTIFY_URL = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/payment-webhook`;
  if (!cfg.DATA_EXPORT_URL && cfg.SUPABASE_URL) cfg.DATA_EXPORT_URL = `${cfg.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/data-export`;
  return cfg;
}
