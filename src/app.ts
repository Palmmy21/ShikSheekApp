/**
 * Composition root: wires config → database → repositories → services → LINE.
 */
import type { AppConfig } from './config/env.ts';
import { createAiPersonality } from './application/personality/ai-assist.ts';
import { createRuleBasedPersonality, type PersonalityService } from './application/personality/personality-service.ts';
import { createClaudeAi, type AiClient } from './infrastructure/ai/claude.ts';
import { createOpenRouterAi } from './infrastructure/ai/openrouter.ts';
import { createEntitlementService } from './application/services/entitlement-service.ts';
import { createPaymentService } from './application/services/payment-service.ts';
import type { PaymentGateway } from './infrastructure/payments/gateway.ts';
import { createStripeGateway } from './infrastructure/payments/stripe.ts';
import { createRichMenuSync } from './application/services/rich-menu-sync.ts';
import { createFinanceService } from './application/services/finance-service.ts';
import { createFixedCostService } from './application/services/fixed-cost-service.ts';
import { createTransactionService } from './application/services/transaction-service.ts';
import { createRepos } from './infrastructure/db/repositories/index.ts';
import type { Sql } from './infrastructure/db/sql.ts';
import { createLineClient, type LineClient } from './infrastructure/line/client.ts';
import { consoleLogger, type AppDeps, type Logger } from './presentation/line/context.ts';
import { configureExportBaseUrl } from './presentation/line/handlers/privacy.ts';
import { configureAssetBaseUrl } from './presentation/line/mascot.ts';
import { configureLiffUrl } from './presentation/line/links.ts';

export interface AppOverrides {
  line?: LineClient;
  personality?: PersonalityService;
  ai?: AiClient | null;
  /** payment gateway (tests inject a fake) */
  gateway?: PaymentGateway;
  clock?: () => Date;
  log?: Logger;
}

export function createAppDeps(
  sql: Sql,
  config: Pick<AppConfig, 'LINE_CHANNEL_ACCESS_TOKEN' | 'PUBLIC_ASSET_BASE_URL' | 'DATA_EXPORT_URL'> & Partial<Pick<AppConfig, 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY' | 'AI_PROVIDER' | 'AI_MODEL' | 'AI_PERSONALITY' | 'LIFF_URL' | 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_PAYMENT_METHOD_CONFIG' | 'PAYMENT_TEST_USERS' | 'PAYMENT_RETURN_URL'>>,
  overrides: AppOverrides = {},
): AppDeps {
  configureAssetBaseUrl(config.PUBLIC_ASSET_BASE_URL);
  if (config.DATA_EXPORT_URL) configureExportBaseUrl(config.DATA_EXPORT_URL);
  configureLiffUrl(config.LIFF_URL);
  const repos = createRepos(sql);
  const ai = overrides.ai !== undefined ? overrides.ai ?? undefined : createAiFromConfig(config);
  const clock = overrides.clock ?? (() => new Date());
  const gateway =
    overrides.gateway ??
    (config.STRIPE_SECRET_KEY
      ? createStripeGateway({
          secretKey: config.STRIPE_SECRET_KEY,
          ...(config.STRIPE_WEBHOOK_SECRET ? { webhookSecret: config.STRIPE_WEBHOOK_SECRET } : {}),
          ...(config.STRIPE_PAYMENT_METHOD_CONFIG ? { paymentMethodConfiguration: config.STRIPE_PAYMENT_METHOD_CONFIG } : {}),
          now: () => clock().getTime(),
        })
      : undefined);
  const personality =
    overrides.personality ?? (ai && config.AI_PERSONALITY === 'true' ? createAiPersonality(ai) : createRuleBasedPersonality());
  const line = overrides.line ?? createLineClient(config.LINE_CHANNEL_ACCESS_TOKEN);
  const log = overrides.log ?? consoleLogger;
  const plans = createEntitlementService(repos, clock);
  return {
    sql,
    repos,
    txns: createTransactionService(sql, repos),
    fixedCosts: createFixedCostService(sql, repos),
    finance: createFinanceService(sql, repos),
    plans,
    richMenus: createRichMenuSync(sql, line, plans, log),
    ...(gateway ? { payments: createPaymentService(repos, gateway, { returnUrl: config.PAYMENT_RETURN_URL ?? 'https://shiksheek.vercel.app/paid', cancelUrl: `${config.PAYMENT_RETURN_URL ?? 'https://shiksheek.vercel.app/paid'}?cancelled=1` }, clock, { allowedUsers: overrides.gateway || config.STRIPE_SECRET_KEY?.includes('_live_') ? null : new Set((config.PAYMENT_TEST_USERS ?? '').split(',').map((u) => u.trim()).filter(Boolean)) }) } : {}),
    personality,
    ...(ai ? { ai } : {}),
    line,
    clock,
    log,
  };
}

/** Pick the AI provider from config. No key → no AI (rule-based only). */
export function createAiFromConfig(config: Partial<Pick<AppConfig, 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY' | 'AI_PROVIDER' | 'AI_MODEL'>>): AiClient | undefined {
  const provider = config.AI_PROVIDER ?? (config.OPENROUTER_API_KEY ? 'openrouter' : config.ANTHROPIC_API_KEY ? 'anthropic' : null);
  if (provider === 'openrouter' && config.OPENROUTER_API_KEY) {
    return createOpenRouterAi({ apiKey: config.OPENROUTER_API_KEY, model: config.AI_MODEL ?? 'anthropic/claude-opus-5.5', siteUrl: 'https://shiksheek.vercel.app' });
  }
  if (provider === 'anthropic' && config.ANTHROPIC_API_KEY) {
    return createClaudeAi({ apiKey: config.ANTHROPIC_API_KEY, model: config.AI_MODEL ?? 'claude-opus-5-5' });
  }
  return undefined;
}
