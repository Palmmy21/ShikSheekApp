/**
 * Entitlements: which plan a user is on and whether they may use a limited feature.
 *
 * - Pro trial: the first TRIAL_DAYS after the user first appeared (derived, no row).
 * - A paid/granted subscription counts until current_period_end; the higher of trial/paid wins.
 * - Existing data is never taken away when a plan lapses: limits only block ADDING more, and
 *   metered features (slips, AI) reset every calendar month (Asia/Bangkok).
 */
import type { LocalDate } from '../../domain/dates.ts';
import { PLAN_RANK, PLANS, TRIAL_DAYS, type LimitFeature, type Plan, type PlanLimits } from '../../domain/plans.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';

export class PlanLimitError extends Error {
  readonly feature: LimitFeature;
  readonly plan: Plan;
  readonly limit: number | null;
  constructor(feature: LimitFeature, plan: Plan, limit: number | null) {
    super(`plan limit: ${feature} on ${plan}`);
    this.name = 'PlanLimitError';
    this.feature = feature;
    this.plan = plan;
    this.limit = limit;
  }
}

export interface PlanStatus {
  plan: Plan;
  limits: PlanLimits;
  /** 'trial' = free Pro trial, 'paid' = subscription/grant, 'free' = no access */
  source: 'free' | 'trial' | 'paid';
  /** ISO time the current access ends (null for free) */
  until: string | null;
  /** whole days left (null for free) */
  daysLeft: number | null;
}

export interface PlanUsage {
  docs: number;
  ai: number;
  fixedCosts: number;
  goals: number;
}

const DAY_MS = 86_400_000;
const monthKey = (today: LocalDate) => today.slice(0, 7);

export function createEntitlementService(repos: Repos, clock: () => Date) {
  async function status(userId: string, now: Date = clock()): Promise<PlanStatus> {
    const [user, sub] = await Promise.all([repos.users.get(userId), repos.plans.getSubscription(userId)]);
    const options: Array<{ plan: Plan; source: PlanStatus['source']; until: number }> = [];
    if (user) {
      const trialEnd = Date.parse(user.createdAt) + TRIAL_DAYS * DAY_MS;
      if (trialEnd > now.getTime()) options.push({ plan: 'pro', source: 'trial', until: trialEnd });
    }
    if (sub) {
      const end = Date.parse(sub.currentPeriodEnd);
      if (end > now.getTime()) options.push({ plan: sub.plan, source: 'paid', until: end });
    }
    // highest plan first; for equal plans prefer the one that lasts longer (paid over trial on ties)
    options.sort((a, b) => PLAN_RANK[b.plan] - PLAN_RANK[a.plan] || b.until - a.until);
    const best = options[0];
    if (!best) return { plan: 'free', limits: PLANS.free, source: 'free', until: null, daysLeft: null };
    return {
      plan: best.plan,
      limits: PLANS[best.plan],
      source: best.source,
      until: new Date(best.until).toISOString(),
      daysLeft: Math.max(0, Math.ceil((best.until - now.getTime()) / DAY_MS)),
    };
  }

  return {
    status,

    async planOf(userId: string, now?: Date): Promise<Plan> {
      return (await status(userId, now)).plan;
    },

    /** Throws PlanLimitError when adding one more item would exceed the plan. */
    async assertCanAdd(userId: string, what: 'fixed_costs' | 'goals' | 'category_budget', categoryId?: string): Promise<void> {
      const s = await status(userId);
      if (what === 'fixed_costs') {
        const limit = s.limits.fixedCosts;
        if (limit !== null && (await repos.fixedCosts.list(userId)).length >= limit) throw new PlanLimitError('fixed_costs', s.plan, limit);
      } else if (what === 'goals') {
        const limit = s.limits.goals;
        if (limit !== null && (await repos.goals.listActive(userId)).length >= limit) throw new PlanLimitError('goals', s.plan, limit);
      } else if (!s.limits.categoryBudgets && categoryId && categoryId !== 'total') {
        // editing a budget the user already has is always fine
        const existing = (await repos.budgets.list(userId)).some((b) => b.categoryId === categoryId);
        if (!existing) throw new PlanLimitError('category_budget', s.plan, null);
      }
    },

    /** Counts one slip/PDF read. Throws PlanLimitError when this month's allowance is used up. */
    async useDocument(userId: string, today: LocalDate): Promise<void> {
      const s = await status(userId);
      const used = await repos.plans.consume(userId, monthKey(today), 'docs', s.limits.docsPerMonth);
      if (used === null) throw new PlanLimitError('docs', s.plan, s.limits.docsPerMonth);
    },

    /** Counts one AI interpretation. false = allowance used up → callers fall back to rules quietly. */
    async useAi(userId: string, today: LocalDate): Promise<boolean> {
      const s = await status(userId);
      if (s.limits.aiPerMonth !== null) return (await repos.plans.consume(userId, monthKey(today), 'ai', s.limits.aiPerMonth)) !== null;
      return (await repos.plans.consume(userId, today, 'ai_day', s.limits.aiPerDay)) !== null;
    },

    async canScheduledPush(userId: string, now?: Date): Promise<boolean> {
      return (await status(userId, now)).limits.scheduledPush;
    },

    /** Free plan: reports may only go back `historyPeriods` periods. `back` = 0 for the current one. */
    async assertHistory(userId: string, back: number): Promise<void> {
      const s = await status(userId);
      const limit = s.limits.historyPeriods;
      if (limit !== null && back >= limit) throw new PlanLimitError('history', s.plan, limit);
    },

    async usage(userId: string, today: LocalDate): Promise<PlanUsage> {
      const [docs, ai, costs, goals] = await Promise.all([
        repos.plans.used(userId, monthKey(today), 'docs'),
        repos.plans.used(userId, monthKey(today), 'ai'),
        repos.fixedCosts.list(userId),
        repos.goals.listActive(userId),
      ]);
      return { docs, ai, fixedCosts: costs.length, goals: goals.length };
    },
  };
}
export type EntitlementService = ReturnType<typeof createEntitlementService>;
