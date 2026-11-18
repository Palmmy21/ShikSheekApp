/**
 * Savings-first money management: the user's ladder position, "เก็บก่อนใช้" when income arrives,
 * and sweeping last period's leftover into savings. Every money movement here is a normal
 * `saving` transaction linked to a goal, deduplicated by external_ref (double taps never save twice).
 */
import {
  averageMonthlyExpense,
  currentStep,
  EMERGENCY_GOAL_NAME,
  emergencyFundTarget,
  isEmergencyGoalName,
  percentOf,
  savingsRateBp,
  type LadderStep,
} from '../../domain/calculations/wealth.ts';
import type { SavingsProgress } from '../../domain/calculations/savings.ts';
import { summarizeTransactions } from '../../domain/calculations/summary.ts';
import type { LocalDate } from '../../domain/dates.ts';
import type { SavingsGoal, Transaction } from '../../domain/entities/index.ts';
import type { Satang } from '../../domain/money.ts';
import { periodForDate, periodFromKey, previousPeriod, type Period } from '../../domain/period.ts';
import type { Repos } from '../../infrastructure/db/repositories/index.ts';
import type { EntitlementService } from './entitlement-service.ts';
import type { FinanceService } from './finance-service.ts';

export interface WealthPlan {
  period: Period;
  incomeSatang: Satang;
  savingSatang: Satang;
  savingsRateBp: number | null;
  avgMonthlyExpenseSatang: Satang | null;
  emergencyTargetSatang: Satang | null;
  emergency: SavingsProgress | null;
  goals: SavingsProgress[];
  totalSavedSatang: Satang;
  step: LadderStep;
}

export type SaveResult =
  | { status: 'saved'; txn: Transaction; goal: SavingsGoal; createdGoal: boolean }
  | { status: 'duplicate' }
  | { status: 'nothing' }
  | { status: 'not_found' };

export function createWealthService(repos: Repos, finance: FinanceService, plans: EntitlementService) {
  async function plan(userId: string, today: LocalDate): Promise<WealthPlan> {
    const user = (await repos.users.get(userId))!;
    const period = periodForDate(today, user.cycleStartDay);
    const p1 = previousPeriod(period);
    const p3 = previousPeriod(previousPeriod(p1));
    const [current, history, goals] = await Promise.all([
      repos.transactions.listByRange(userId, period.start, period.end),
      repos.transactions.listByRange(userId, p3.start, p1.end),
      finance.goals(userId),
    ]);
    const totals = summarizeTransactions(current, { start: period.start, end: period.end });
    const perPeriod = [p3, previousPeriod(p1), p1].map((p) => summarizeTransactions(history, { start: p.start, end: p.end }).expenseSatang);
    const avg = averageMonthlyExpense(perPeriod) ?? (totals.expenseSatang > 0 ? totals.expenseSatang : null);
    const target = avg === null ? null : emergencyFundTarget(avg);
    const emergency = goals.find((g) => isEmergencyGoalName(g.goal.name)) ?? null;
    const rate = savingsRateBp(totals.incomeSatang, totals.savingSatang);
    return {
      period,
      incomeSatang: totals.incomeSatang,
      savingSatang: totals.savingSatang,
      savingsRateBp: rate,
      avgMonthlyExpenseSatang: avg,
      emergencyTargetSatang: target,
      emergency,
      goals,
      totalSavedSatang: goals.reduce((s, g) => s + g.savedSatang, 0),
      step: currentStep({
        emergencySaved: emergency?.savedSatang ?? 0,
        emergencyTarget: target,
        savingsRateBp: rate,
        openGoals: goals.filter((g) => !g.isReached && g !== emergency).length,
      }),
    };
  }

  /** Where new savings should go: unfinished emergency fund → first unfinished goal → (create) emergency fund. */
  async function targetGoal(userId: string, today: LocalDate, fallbackTarget: Satang): Promise<{ goal: SavingsGoal; created: boolean }> {
    const p = await plan(userId, today);
    if (p.emergency && !p.emergency.isReached) return { goal: p.emergency.goal, created: false };
    const open = p.goals.find((g) => !g.isReached);
    if (open) return { goal: open.goal, created: false };
    if (p.emergency) return { goal: p.emergency.goal, created: false };
    await plans.assertCanAdd(userId, 'goals'); // PlanLimitError → upgrade card
    const goal = await finance.createGoal(userId, { name: EMERGENCY_GOAL_NAME, targetSatang: p.emergencyTargetSatang ?? fallbackTarget, monthlyReserveSatang: 0 });
    return { goal, created: true };
  }

  async function saveInto(userId: string, amount: Satang, txnDate: LocalDate, today: LocalDate, ref: string, note: string, fallbackTarget: Satang): Promise<SaveResult> {
    if (await repos.transactions.findByExternalRef(userId, ref)) return { status: 'duplicate' };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { status: 'nothing' };
    const { goal, created } = await targetGoal(userId, today, fallbackTarget);
    const txn = await repos.transactions.insertIfNewRef({ userId, type: 'saving', amountSatang: amount, categoryId: 'savings', note, txnDate, source: 'savings', savingsGoalId: goal.id, externalRef: ref });
    return txn ? { status: 'saved', txn, goal, createdGoal: created } : { status: 'duplicate' };
  }

  return {
    plan,

    /** Create the emergency-fund goal (target = 3 months of expenses) if the user has none. */
    async ensureEmergencyGoal(userId: string, today: LocalDate): Promise<{ goal: SavingsGoal; created: boolean }> {
      const p = await plan(userId, today);
      if (p.emergency) return { goal: p.emergency.goal, created: false };
      await plans.assertCanAdd(userId, 'goals');
      const goal = await finance.createGoal(userId, { name: EMERGENCY_GOAL_NAME, targetSatang: p.emergencyTargetSatang ?? 3_000_000, monthlyReserveSatang: 0 });
      return { goal, created: true };
    },

    /** "เก็บก่อนใช้": move `percent`% of an income entry into savings, once per income entry. */
    async saveFirst(userId: string, incomeTxnId: string, percent: number, today: LocalDate): Promise<SaveResult> {
      const income = await repos.transactions.get(userId, incomeTxnId);
      if (!income || income.deletedAt || income.type !== 'income') return { status: 'not_found' };
      const amount = percentOf(income.amountSatang, percent);
      return saveInto(userId, amount, today, today, `sf:${incomeTxnId}`, `เก็บก่อนใช้ ${percent}%`, income.amountSatang * 3);
    },

    /** Last period's leftover (income − expense − saving), or 0. */
    async leftover(userId: string, periodKey: string): Promise<{ period: Period; leftoverSatang: Satang; swept: boolean }> {
      const user = (await repos.users.get(userId))!;
      const period = periodFromKey(periodKey, user.cycleStartDay);
      const txns = await repos.transactions.listByRange(userId, period.start, period.end);
      const net = summarizeTransactions(txns, { start: period.start, end: period.end }).netSatang;
      const swept = !!(await repos.transactions.findByExternalRef(userId, `sweep:${periodKey}`));
      return { period, leftoverSatang: Math.max(0, net), swept };
    },

    /** Move all/half of an ENDED period's leftover into savings, dated on that period's last day. */
    async sweep(userId: string, periodKey: string, fraction: 'all' | 'half', today: LocalDate): Promise<SaveResult> {
      const { period, leftoverSatang } = await this.leftover(userId, periodKey);
      if (period.end >= today) return { status: 'nothing' }; // only finished periods
      const amount = fraction === 'all' ? leftoverSatang : percentOf(leftoverSatang, 50);
      return saveInto(userId, amount, period.end, today, `sweep:${periodKey}`, 'เงินเหลือสิ้นเดือน', leftoverSatang * 3);
    },
  };
}
export type WealthService = ReturnType<typeof createWealthService>;
