import type { Sql } from '../sql.ts';
import { budgetRepo, goalRepo } from './budgets-goals.ts';
import { conversationRepo, jobRunRepo, pendingActionRepo } from './conversation.ts';
import { fixedCostRepo } from './fixed-costs.ts';
import { transactionRepo } from './transactions.ts';
import { userRepo } from './users.ts';
import { webhookEventRepo } from './webhook-events.ts';
import { categoryRuleRepo } from './category-rules.ts';
import { planRepo } from './plans.ts';
import { paymentRepo } from './payments.ts';
import { engagementRepo } from './engagement.ts';

export function createRepos(sql: Sql) {
  return {
    users: userRepo(sql),
    transactions: transactionRepo(sql),
    fixedCosts: fixedCostRepo(sql),
    budgets: budgetRepo(sql),
    goals: goalRepo(sql),
    pending: pendingActionRepo(sql),
    conversation: conversationRepo(sql),
    jobRuns: jobRunRepo(sql),
    webhookEvents: webhookEventRepo(sql),
    categoryRules: categoryRuleRepo(sql),
    plans: planRepo(sql),
    payments: paymentRepo(sql),
    engagement: engagementRepo(sql),
  };
}
export type Repos = ReturnType<typeof createRepos>;
