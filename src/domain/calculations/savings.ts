/**
 * Savings goal progress. Saved amount is DERIVED from 'saving' transactions, never stored.
 */
import type { SavingsGoal, Transaction } from '../entities/index.ts';
import { ratioBasisPoints, type Satang } from '../money.ts';

export interface SavingsProgress {
  goal: SavingsGoal;
  savedSatang: Satang;
  remainingSatang: Satang; // >= 0
  progressBasisPoints: number; // capped at 10000
  isReached: boolean;
  /** Periods needed at the monthly reserve to reach target; null if no reserve set or reached. */
  periodsToGoal: number | null;
}

export function savedForGoal(goalId: string, txns: readonly Transaction[]): Satang {
  return txns
    .filter((t) => t.deletedAt === null && t.type === 'saving' && t.savingsGoalId === goalId)
    .reduce((s, t) => s + t.amountSatang, 0);
}

export function computeSavingsProgress(goal: SavingsGoal, txns: readonly Transaction[]): SavingsProgress {
  const saved = savedForGoal(goal.id, txns);
  const remaining = Math.max(0, goal.targetSatang - saved);
  const reached = saved >= goal.targetSatang;
  return {
    goal,
    savedSatang: saved,
    remainingSatang: remaining,
    progressBasisPoints: Math.min(10_000, ratioBasisPoints(saved, goal.targetSatang)),
    isReached: reached,
    periodsToGoal: reached || goal.monthlyReserveSatang <= 0 ? null : Math.ceil(remaining / goal.monthlyReserveSatang),
  };
}
