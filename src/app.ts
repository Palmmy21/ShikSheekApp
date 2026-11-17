/**
 * Composition root: wires config → database → repositories → services → LINE.
 */
import type { AppConfig } from './config/env.ts';
import { createAiPersonality } from './application/personality/ai-assist.ts';
import { createRuleBasedPersonality, type PersonalityService } from './application/personality/personality-service.ts';
import { createClaudeAi, type AiClient } from './infrastructure/ai/claude.ts';
import { createFinanceService } from './application/services/finance-service.ts';
import { createFixedCostService } from './application/services/fixed-cost-service.ts';
import { createTransactionService } from './application/services/transaction-service.ts';
import { createRepos } from './infrastructure/db/repositories/index.ts';
import type { Sql } from './infrastructure/db/sql.ts';
import { createLineClient, type LineClient } from './infrastructure/line/client.ts';
import { consoleLogger, type AppDeps, type Logger } from './presentation/line/context.ts';
import { configureExportBaseUrl } from './presentation/line/handlers/privacy.ts';
import { configureAssetBaseUrl } from './presentation/line/mascot.ts';

export interface AppOverrides {
  line?: LineClient;
  personality?: PersonalityService;
  ai?: AiClient | null;
  clock?: () => Date;
  log?: Logger;
}

export function createAppDeps(
  sql: Sql,
  config: Pick<AppConfig, 'LINE_CHANNEL_ACCESS_TOKEN' | 'PUBLIC_ASSET_BASE_URL' | 'DATA_EXPORT_URL'> & Partial<Pick<AppConfig, 'ANTHROPIC_API_KEY' | 'AI_MODEL' | 'AI_PERSONALITY'>>,
  overrides: AppOverrides = {},
): AppDeps {
  configureAssetBaseUrl(config.PUBLIC_ASSET_BASE_URL);
  if (config.DATA_EXPORT_URL) configureExportBaseUrl(config.DATA_EXPORT_URL);
  const repos = createRepos(sql);
  const ai =
    overrides.ai !== undefined
      ? overrides.ai ?? undefined
      : config.ANTHROPIC_API_KEY
        ? createClaudeAi({ apiKey: config.ANTHROPIC_API_KEY, model: config.AI_MODEL ?? 'claude-opus-5-5' })
        : undefined;
  const personality =
    overrides.personality ?? (ai && config.AI_PERSONALITY === 'true' ? createAiPersonality(ai) : createRuleBasedPersonality());
  return {
    sql,
    repos,
    txns: createTransactionService(sql, repos),
    fixedCosts: createFixedCostService(sql, repos),
    finance: createFinanceService(sql, repos),
    personality,
    ...(ai ? { ai } : {}),
    line: overrides.line ?? createLineClient(config.LINE_CHANNEL_ACCESS_TOKEN),
    clock: overrides.clock ?? (() => new Date()),
    log: overrides.log ?? consoleLogger,
  };
}
