/**
 * Composition root: wires config → database → repositories → services → LINE.
 */
import type { AppConfig } from './config/env.ts';
import { createRuleBasedPersonality, type PersonalityService } from './application/personality/personality-service.ts';
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
  clock?: () => Date;
  log?: Logger;
}

export function createAppDeps(
  sql: Sql,
  config: Pick<AppConfig, 'LINE_CHANNEL_ACCESS_TOKEN' | 'PUBLIC_ASSET_BASE_URL' | 'DATA_EXPORT_URL'>,
  overrides: AppOverrides = {},
): AppDeps {
  configureAssetBaseUrl(config.PUBLIC_ASSET_BASE_URL);
  if (config.DATA_EXPORT_URL) configureExportBaseUrl(config.DATA_EXPORT_URL);
  const repos = createRepos(sql);
  return {
    sql,
    repos,
    txns: createTransactionService(sql, repos),
    fixedCosts: createFixedCostService(sql, repos),
    finance: createFinanceService(sql, repos),
    personality: overrides.personality ?? createRuleBasedPersonality(),
    line: overrides.line ?? createLineClient(config.LINE_CHANNEL_ACCESS_TOKEN),
    clock: overrides.clock ?? (() => new Date()),
    log: overrides.log ?? consoleLogger,
  };
}
