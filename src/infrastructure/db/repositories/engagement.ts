import { applyGrant, type PaidPlan } from '../../../domain/plans.ts';
import { toIso, type Sql } from '../sql.ts';

/** Bangkok wall-clock date of a timestamptz, without needing the tz database (UTC+7, no DST). */
const BKK_DAY = (col: string) => `to_char((${col} at time zone 'UTC') + interval '7 hours', 'YYYY-MM-DD')`;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function engagementRepo(sql: Sql) {
  return {
    /** Distinct Bangkok days with a recorded (not deleted) entry in the last `days` days, plus the DB's Bangkok "today". */
    async activity(userId: string, days = 400): Promise<{ activeDays: string[]; today: string; entriesToday: number }> {
      const rows = await sql.query<{ d: string; n: unknown }>(
        `select ${BKK_DAY('created_at')} as d, count(*) as n from transactions
         where user_id = $1 and deleted_at is null and created_at > now() - make_interval(days => $2)
         group by 1`,
        [userId, days],
      );
      const t = await sql.query<{ today: string }>(`select ${BKK_DAY('now()')} as today`);
      const today = t[0]!.today;
      return { activeDays: rows.map((r) => r.d), today, entriesToday: Number(rows.find((r) => r.d === today)?.n ?? 0) };
    },

    async entryCount(userId: string): Promise<number> {
      const rows = await sql.query<{ n: unknown }>(`select count(*) as n from transactions where user_id = $1 and deleted_at is null`, [userId]);
      return Number(rows[0]?.n ?? 0);
    },

    /** The user's referral code, created on first use. */
    async referralCode(userId: string): Promise<string> {
      for (let i = 0; i < 8; i++) {
        const existing = await sql.query<{ referral_code: string | null }>(`select referral_code from users where line_user_id = $1`, [userId]);
        if (existing[0]?.referral_code) return existing[0].referral_code;
        try {
          const rows = await sql.query<{ referral_code: string }>(
            `update users set referral_code = $2 where line_user_id = $1 and referral_code is null returning referral_code`,
            [userId, newReferralCode()],
          );
          if (rows[0]) return rows[0].referral_code;
        } catch {
          // code collision (unique) → try another
        }
      }
      throw new Error('could not allocate a referral code');
    },

    async userByCode(code: string): Promise<{ userId: string; displayName: string | null } | null> {
      const rows = await sql.query<{ line_user_id: string; display_name: string | null }>(`select line_user_id, display_name from users where referral_code = $1`, [code.toUpperCase()]);
      return rows[0] ? { userId: rows[0].line_user_id, displayName: rows[0].display_name } : null;
    },

    /** true when recorded (a user can be referred only once). */
    async addReferral(refereeId: string, referrerId: string): Promise<boolean> {
      const rows = await sql.query(`insert into referrals (referee_id, referrer_id) values ($1, $2) on conflict do nothing returning referee_id`, [refereeId, referrerId]);
      return rows.length > 0;
    },

    async referralOf(refereeId: string): Promise<{ referrerId: string; rewardedAt: string | null } | null> {
      const rows = await sql.query<{ referrer_id: string; rewarded_at: unknown }>(`select referrer_id, rewarded_at from referrals where referee_id = $1`, [refereeId]);
      return rows[0] ? { referrerId: rows[0].referrer_id, rewardedAt: rows[0].rewarded_at ? toIso(rows[0].rewarded_at) : null } : null;
    },

    async referralStats(referrerId: string): Promise<{ invited: number; rewarded: number }> {
      const rows = await sql.query<{ invited: unknown; rewarded: unknown }>(
        `select count(*) as invited, count(rewarded_at) as rewarded from referrals where referrer_id = $1`,
        [referrerId],
      );
      return { invited: Number(rows[0]?.invited ?? 0), rewarded: Number(rows[0]?.rewarded ?? 0) };
    },

    /** pending → rewarded exactly once. Returns the referrer id when this call won. */
    async markReferralRewarded(refereeId: string): Promise<string | null> {
      const rows = await sql.query<{ referrer_id: string }>(
        `update referrals set rewarded_at = now() where referee_id = $1 and rewarded_at is null returning referrer_id`,
        [refereeId],
      );
      return rows[0]?.referrer_id ?? null;
    },

    /**
     * Grant `days` of `plan` once per (user, key), extending the subscription in the same transaction.
     * Returns the new end, or null when this reward was already granted.
     */
    async grantOnce(userId: string, key: string, plan: PaidPlan, days: number, source: 'referral' | 'promo', now: Date): Promise<{ plan: PaidPlan; end: string } | null> {
      return sql.transaction(async (tx) => {
        const ins = await tx.query(`insert into user_rewards (user_id, reward_key, days) values ($1, $2, $3) on conflict do nothing returning user_id`, [userId, key, days]);
        if (ins.length === 0) return null;
        const cur = await tx.query<{ plan: PaidPlan; current_period_end: unknown }>(`select plan, current_period_end from subscriptions where user_id = $1 for update`, [userId]);
        const current = cur[0] ? { plan: cur[0].plan, end: Date.parse(toIso(cur[0].current_period_end)) } : null;
        const next = applyGrant(current, plan, days, now.getTime());
        const end = new Date(next.end).toISOString();
        await tx.query(
          `insert into subscriptions (user_id, plan, source, current_period_end) values ($1, $2, $3, $4)
           on conflict (user_id) do update set plan = excluded.plan, current_period_end = excluded.current_period_end, updated_at = now(),
             source = case when subscriptions.source = 'payment' then 'payment' else excluded.source end`,
          [userId, next.plan, source, end],
        );
        return { plan: next.plan, end };
      });
    },

    /**
     * Savings rate (kept ÷ income, basis points, floored at 0) of every user with income between
     * `start` and `end`. Aggregates only — used for the anonymous "out-saved X%" line on story cards.
     */
    async savingsRates(start: string, end: string): Promise<number[]> {
      const rows = await sql.query<{ bp: unknown }>(
        `select greatest(0, ((inc - exp) * 10000) / inc) as bp from (
           select user_id,
                  sum(amount_satang) filter (where type = 'income') as inc,
                  coalesce(sum(amount_satang) filter (where type = 'expense'), 0) as exp
           from transactions
           where deleted_at is null and txn_date between $1 and $2
           group by user_id
         ) t where inc > 0`,
        [start, end],
      );
      return rows.map((r) => Number(r.bp));
    },

    async recordStoryShare(userId: string, card: string, method: 'share' | 'download'): Promise<void> {
      await sql.query(`insert into story_shares (user_id, card, method) values ($1, $2, $3)`, [userId, card, method]);
    },

    async storyShareCount(userId: string): Promise<number> {
      const rows = await sql.query<{ n: unknown }>(`select count(*) as n from story_shares where user_id = $1`, [userId]);
      return Number(rows[0]?.n ?? 0);
    },

    /** Following users who want streak reminders. */
    async listStreakRecipients(): Promise<string[]> {
      const rows = await sql.query<{ line_user_id: string }>(`select line_user_id from users where is_following and notify_streak`);
      return rows.map((r) => r.line_user_id);
    },
  };
}
export type EngagementRepo = ReturnType<typeof engagementRepo>;
