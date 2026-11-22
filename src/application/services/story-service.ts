/**
 * Story cards ("ชิกชิก Wrapped"): gathers this user's numbers and hands them to the pure deck builder.
 *
 * Which month: during the first STORY_RECAP_DAYS days of a cycle the previous (complete) cycle is the
 * story — that's when people want to show off a finished month; afterwards it's the current one so far.
 */
import { buildStoryDeck, percentileBeaten, savingsRateBp, type StoryCardKind, type StoryDeck } from '../../domain/calculations/story.ts';
import { summarizeTransactions } from '../../domain/calculations/summary.ts';
import { addDays, type LocalDate } from '../../domain/dates.ts';
import { periodForDate, previousPeriod } from '../../domain/period.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { EngagementService } from './engagement-service.ts';
import type { EntitlementService } from './entitlement-service.ts';
import type { FinanceService } from './finance-service.ts';

export const STORY_RECAP_DAYS = 5;

export function createStoryService(repos: Repos, finance: FinanceService, engagement: EngagementService, plans: EntitlementService) {
  return {
    async deck(userId: string, today: LocalDate): Promise<StoryDeck & { period: { start: string; end: string } }> {
      const user = await repos.users.get(userId);
      if (!user) throw new Error('user not found');
      const current = periodForDate(today, user.cycleStartDay);
      const period = today < addDays(current.start, STORY_RECAP_DAYS) ? previousPeriod(current) : current;
      const inProgress = period.end >= today;
      const asOf = inProgress ? today : period.end;
      const prev = previousPeriod(period);

      const [txns, prevTxns, goals, streak, referral, status] = await Promise.all([
        repos.transactions.listByRange(userId, period.start, asOf),
        repos.transactions.listByRange(userId, prev.start, prev.end),
        finance.goals(userId),
        engagement.streak(userId),
        engagement.referralInfo(userId),
        plans.status(userId),
      ]);
      const totals = summarizeTransactions(txns, { start: period.start, end: asOf });
      const prevTotals = summarizeTransactions(prevTxns, { start: prev.start, end: prev.end });
      const rate = savingsRateBp(totals);
      const savingsPercentile = rate === null ? null : percentileBeaten(rate, await repos.engagement.savingsRates(period.start, asOf));

      const deck = buildStoryDeck({
        displayName: user.displayName,
        periodStart: period.start,
        inProgress,
        totals,
        previousExpenseSatang: prevTotals.transactionCount > 0 ? prevTotals.expenseSatang : null,
        streakDays: streak.days,
        goals: goals.map((g) => ({ name: g.goal.name, savedSatang: g.savedSatang, targetSatang: g.goal.targetSatang, progressBasisPoints: g.progressBasisPoints, isReached: g.isReached })),
        savingsPercentile,
        plan: status.plan,
        planSource: status.source,
        referralCode: referral.code,
      });
      return { ...deck, period: { start: period.start, end: period.end } };
    },

    async recordShare(userId: string, card: StoryCardKind, method: 'share' | 'download'): Promise<void> {
      await repos.engagement.recordStoryShare(userId, card, method);
    },
  };
}
export type StoryService = ReturnType<typeof createStoryService>;
