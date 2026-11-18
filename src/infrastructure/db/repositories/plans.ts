import type { PaidPlan } from '../../../domain/plans.ts';
import { toIso, type Sql } from '../sql.ts';

export type SubscriptionSource = 'manual' | 'promo' | 'referral' | 'payment';
export interface SubscriptionRow {
  plan: PaidPlan;
  source: SubscriptionSource;
  currentPeriodEnd: string;
}
export type MeteredFeature = 'docs' | 'ai' | 'ai_day';

export function planRepo(sql: Sql) {
  return {
    async getSubscription(userId: string): Promise<SubscriptionRow | null> {
      const rows = await sql.query<{ plan: PaidPlan; source: SubscriptionSource; current_period_end: unknown }>(
        `select plan, source, current_period_end from subscriptions where user_id = $1`,
        [userId],
      );
      const r = rows[0];
      return r ? { plan: r.plan, source: r.source, currentPeriodEnd: toIso(r.current_period_end) } : null;
    },

    /** Set a subscription ending at `end` (admin grants, later: payment webhook). */
    async setSubscription(userId: string, plan: PaidPlan, source: SubscriptionSource, end: Date): Promise<void> {
      await sql.query(
        `insert into subscriptions (user_id, plan, source, current_period_end) values ($1, $2, $3, $4)
         on conflict (user_id) do update set plan = excluded.plan, source = excluded.source,
           current_period_end = excluded.current_period_end, updated_at = now()`,
        [userId, plan, source, end.toISOString()],
      );
    },

    /** Atomically +1 while below `limit` (null = no cap). Returns the new count, or null when capped. */
    async consume(userId: string, period: string, feature: MeteredFeature, limit: number | null): Promise<number | null> {
      if (limit !== null && limit <= 0) return null;
      const rows = await sql.query<{ used: number }>(
        `insert into usage_counters (user_id, period, feature, used) values ($1, $2, $3, 1)
         on conflict (user_id, period, feature) do update set used = usage_counters.used + 1
           where $4::int is null or usage_counters.used < $4::int
         returning used`,
        [userId, period, feature, limit],
      );
      return rows[0] ? Number(rows[0].used) : null;
    },

    async used(userId: string, period: string, feature: MeteredFeature): Promise<number> {
      const rows = await sql.query<{ used: number }>(
        `select used from usage_counters where user_id = $1 and period = $2 and feature = $3`,
        [userId, period, feature],
      );
      return rows[0] ? Number(rows[0].used) : 0;
    },

    /** true when newly recorded */
    async addInterest(userId: string, plan: PaidPlan): Promise<boolean> {
      const rows = await sql.query(
        `insert into plan_interest (user_id, plan) values ($1, $2) on conflict do nothing returning user_id`,
        [userId, plan],
      );
      return rows.length > 0;
    },
  };
}
export type PlanRepo = ReturnType<typeof planRepo>;
