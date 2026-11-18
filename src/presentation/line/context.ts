import type { EntitlementService } from '../../application/services/entitlement-service.ts';
import type { PaymentService } from '../../application/services/payment-service.ts';
import type { FinanceService } from '../../application/services/finance-service.ts';
import type { FixedCostService } from '../../application/services/fixed-cost-service.ts';
import type { TransactionService } from '../../application/services/transaction-service.ts';
import type { PersonalityService } from '../../application/personality/personality-service.ts';
import type { LocalDate } from '../../domain/dates.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';
import type { AiClient } from '../../infrastructure/ai/claude.ts';
import type { LineClient } from '../../infrastructure/line/client.ts';
import type { Message } from '../../infrastructure/line/messages.ts';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface AppDeps {
  sql: Sql;
  repos: Repos;
  txns: TransactionService;
  fixedCosts: FixedCostService;
  finance: FinanceService;
  /** plan, limits and metered usage */
  plans: EntitlementService;
  /** PromptPay checkout via Stripe; absent until merchant credentials are configured. */
  payments?: PaymentService;
  personality: PersonalityService;
  /** Optional Claude layer for messages the rule-based parser cannot understand. */
  ai?: AiClient;
  line: LineClient;
  clock: () => Date;
  log: Logger;
}

export interface HandlerContext {
  userId: string;
  now: Date;
  today: LocalDate;
  deps: AppDeps;
}

export type HandlerResult = Message[];

/** Conversation states for multi-step flows (stored in conversation_states). */
export type FlowState =
  | { state: 'await_amount'; context: { type: 'income' | 'expense'; categoryId: string } }
  | { state: 'await_entry'; context: { type: 'income' | 'expense' } }
  | { state: 'await_fixed_cost'; context: Record<string, never> }
  | { state: 'await_goal'; context: Record<string, never> }
  | { state: 'await_budget_amount'; context: { categoryId: string } }
  | { state: 'await_goal_contribution'; context: { goalId: string } }
  | { state: 'await_fc_amount'; context: { occurrenceId: string } };

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: 'info', msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
};

/** Shorten a LINE user id for logs (never log full ids alongside amounts). */
export function redactUserId(userId: string): string {
  return `${userId.slice(0, 5)}…${userId.slice(-4)}`;
}
