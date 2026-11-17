/**
 * Available-to-spend ("เงินที่ใช้ได้จริง") for one budget period.
 *
 *   available = income
 *             − expenses                    (includes Fixed Costs already PAID — they are expense transactions)
 *             − savings contributed         (money already moved to goals)
 *             − unpaid Fixed Costs          (pending occurrences due on/before period end, incl. overdue)
 *             − savings still to reserve    (per goal: max(0, monthlyReserve − contributed this period))
 *
 * No double counting:
 *  • A paid occurrence is excluded from "unpaid" — its cost is counted once, via its expense transaction.
 *  • A goal's reservation shrinks as contributions arrive, so reserve + contribution never exceeds
 *    max(reserve, contribution) for that goal.
 *  • Skipped occurrences cost nothing.
 *
 * No carry-over from previous periods (decision 2026-11-18). Result may be negative.
 */
import type { LocalDate } from '../dates.ts';
import type { FixedCostOccurrence, SavingsGoal, Transaction } from '../entities/index.ts';
import { divideFloor, type Satang } from '../money.ts';
import { daysRemainingInclusive, type Period } from '../period.ts';
import { filterTransactions, summarizeTransactions } from './summary.ts';

export interface AvailableInput {
  period: Period;
  today: LocalDate;
  transactions: readonly Transaction[];
  occurrences: readonly FixedCostOccurrence[];
  savingsGoals: readonly SavingsGoal[];
}

export interface AvailableBreakdown {
  incomeSatang: Satang;
  expenseSatang: Satang;
  /** Portion of expenseSatang that paid Fixed Cost occurrences (informational). */
  paidFixedCostsSatang: Satang;
  unpaidFixedCostsSatang: Satang;
  unpaidFixedCostCount: number;
  savingContributedSatang: Satang;
  savingsReservedSatang: Satang;
  availableSatang: Satang;
  daysRemaining: number;
  /** available / days remaining (floored). 0 when available <= 0 or no days remain. */
  dailyAllowanceSatang: Satang;
  isNegative: boolean;
  hasIncome: boolean;
}

export function outstandingOccurrences(
  occurrences: readonly FixedCostOccurrence[],
  throughDate: LocalDate,
): FixedCostOccurrence[] {
  return occurrences.filter((o) => o.status === 'pending' && o.dueDate <= throughDate);
}

export function savingsReservationFor(
  goal: SavingsGoal,
  contributedThisPeriod: Satang,
): Satang {
  if (goal.status !== 'active') return 0;
  return Math.max(0, goal.monthlyReserveSatang - contributedThisPeriod);
}

export function calculateAvailable(input: AvailableInput): AvailableBreakdown {
  const { period, today } = input;
  const range = { start: period.start, end: period.end };
  const totals = summarizeTransactions(input.transactions, range);

  const paidFixed = filterTransactions(input.transactions, range, 'expense')
    .filter((t) => t.fixedCostOccurrenceId !== null)
    .reduce((s, t) => s + t.amountSatang, 0);

  // Occurrence already settled by an active transaction must never be counted as unpaid,
  // even if its status row lags behind (defensive: status and link are updated atomically in SQL).
  const settledOccurrenceIds = new Set(
    input.transactions.filter((t) => t.deletedAt === null && t.fixedCostOccurrenceId).map((t) => t.fixedCostOccurrenceId!),
  );
  const unpaid = outstandingOccurrences(input.occurrences, period.end).filter((o) => !settledOccurrenceIds.has(o.id));
  const unpaidSum = unpaid.reduce((s, o) => s + o.amountSatang, 0);

  const contributedByGoal = new Map<string, Satang>();
  for (const t of filterTransactions(input.transactions, range, 'saving')) {
    const key = t.savingsGoalId ?? '';
    contributedByGoal.set(key, (contributedByGoal.get(key) ?? 0) + t.amountSatang);
  }
  const reserved = input.savingsGoals.reduce(
    (s, g) => s + savingsReservationFor(g, contributedByGoal.get(g.id) ?? 0),
    0,
  );

  const available = totals.incomeSatang - totals.expenseSatang - totals.savingSatang - unpaidSum - reserved;
  const daysRemaining = daysRemainingInclusive(period, today);
  const dailyAllowance = available > 0 && daysRemaining > 0 ? divideFloor(available, daysRemaining) : 0;

  return {
    incomeSatang: totals.incomeSatang,
    expenseSatang: totals.expenseSatang,
    paidFixedCostsSatang: paidFixed,
    unpaidFixedCostsSatang: unpaidSum,
    unpaidFixedCostCount: unpaid.length,
    savingContributedSatang: totals.savingSatang,
    savingsReservedSatang: reserved,
    availableSatang: available,
    daysRemaining,
    dailyAllowanceSatang: dailyAllowance,
    isNegative: available < 0,
    hasIncome: totals.incomeSatang > 0,
  };
}
