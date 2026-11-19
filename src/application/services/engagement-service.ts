/**
 * Daily use, retention and word of mouth:
 * - streaks (consecutive days with an entry) + a one-time Plus bonus at 30 days
 * - referrals: a new user enters a friend's code; after they record REFERRAL_ACTIVATION_ENTRIES
 *   entries, BOTH get REFERRAL_REWARD_DAYS of Plus (inviter capped at REFERRAL_MAX_REWARDS).
 * Rewards are idempotent (user_rewards) and never touch payments.
 */
import { computeStreak, milestoneReached, STREAK_REWARD_AT, STREAK_REWARD_DAYS, type Streak } from '../../domain/calculations/streak.ts';
import { REFERRAL_ACTIVATION_ENTRIES, REFERRAL_MAX_REWARDS, REFERRAL_REWARD_DAYS } from '../../domain/plans.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';

const NEW_USER_DAYS = 7;
export const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

export type ClaimResult =
  | { status: 'ok'; referrerName: string | null }
  | { status: 'invalid' | 'self' | 'already' | 'not_new' };

export interface EntryOutcome {
  streak: Streak;
  milestone: number | null;
  /** end of the Plus bonus just granted for the 30-day streak */
  streakRewardUntil: string | null;
  /** referral just activated: this user's Plus end, and the inviter to notify */
  referral: { refereeUntil: string | null; referrerId: string; referrerUntil: string | null } | null;
}

export function createEngagementService(repos: Repos, clock: () => Date) {
  async function streak(userId: string): Promise<Streak & { entriesToday: number }> {
    const a = await repos.engagement.activity(userId);
    return { ...computeStreak(a.activeDays, a.today), entriesToday: a.entriesToday };
  }

  return {
    streak,

    async referralInfo(userId: string): Promise<{ code: string; invited: number; rewarded: number; remaining: number }> {
      const [code, stats] = await Promise.all([repos.engagement.referralCode(userId), repos.engagement.referralStats(userId)]);
      return { code, ...stats, remaining: Math.max(0, REFERRAL_MAX_REWARDS - stats.rewarded) };
    },

    async claim(userId: string, rawCode: string): Promise<ClaimResult> {
      const code = rawCode.trim().toUpperCase();
      if (!REFERRAL_CODE_RE.test(code)) return { status: 'invalid' };
      const referrer = await repos.engagement.userByCode(code);
      if (!referrer) return { status: 'invalid' };
      if (referrer.userId === userId) return { status: 'self' };
      if (await repos.engagement.referralOf(userId)) return { status: 'already' };
      const me = await repos.users.get(userId);
      if (!me || clock().getTime() - Date.parse(me.createdAt) > NEW_USER_DAYS * 86_400_000) return { status: 'not_new' };
      // the inviter must not be someone this user already invited (no A↔B loops)
      const theirs = await repos.engagement.referralOf(referrer.userId);
      if (theirs?.referrerId === userId) return { status: 'self' };
      if (!(await repos.engagement.addReferral(userId, referrer.userId))) return { status: 'already' };
      return { status: 'ok', referrerName: referrer.displayName };
    },

    /** Call after an entry is saved: streak, milestone, streak bonus and referral activation. */
    async onEntryRecorded(userId: string): Promise<EntryOutcome> {
      const now = clock();
      const s = await streak(userId);
      let streakRewardUntil: string | null = null;
      if (s.days >= STREAK_REWARD_AT) {
        streakRewardUntil = (await repos.engagement.grantOnce(userId, `streak${STREAK_REWARD_AT}`, 'plus', STREAK_REWARD_DAYS, 'promo', now))?.end ?? null;
      }
      let referral: EntryOutcome['referral'] = null;
      const ref = await repos.engagement.referralOf(userId);
      if (ref && !ref.rewardedAt && (await repos.engagement.entryCount(userId)) >= REFERRAL_ACTIVATION_ENTRIES) {
        const referrerId = await repos.engagement.markReferralRewarded(userId);
        if (referrerId) {
          const refereeUntil = (await repos.engagement.grantOnce(userId, 'referred', 'plus', REFERRAL_REWARD_DAYS, 'referral', now))?.end ?? null;
          const { rewarded } = await repos.engagement.referralStats(referrerId); // includes this one
          const referrerUntil =
            rewarded <= REFERRAL_MAX_REWARDS ? ((await repos.engagement.grantOnce(referrerId, `referral:${userId}`, 'plus', REFERRAL_REWARD_DAYS, 'referral', now))?.end ?? null) : null;
          referral = { refereeUntil, referrerId, referrerUntil };
        }
      }
      return { streak: s, milestone: milestoneReached(s, s.entriesToday), streakRewardUntil, referral };
    },
  };
}
export type EngagementService = ReturnType<typeof createEngagementService>;
