/**
 * "มีเงินเหลือเก็บ แล้วต่อยอด" — a simple, conservative money ladder:
 *   1. Emergency fund = 3 months of normal expenses (stretch: 6)
 *   2. Save at least 20% of income every month ("เก็บก่อนใช้")
 *   3. Fund your own goals
 *   4. Grow long-term (general education only — never product picks)
 * Pure functions on integer satang.
 */
import type { Satang } from '../money.ts';

export const TARGET_SAVINGS_RATE_BP = 2000; // 20%
export const EMERGENCY_MONTHS = 3;
export const EMERGENCY_STRETCH_MONTHS = 6;
export const SAVE_FIRST_MIN_INCOME: Satang = 300_000; // offer "เก็บก่อนใช้" for income ≥ ฿3,000
export const SAVE_FIRST_PERCENTS = [10, 20, 30] as const;

/** saving ÷ income in basis points; null when there is no income. */
export function savingsRateBp(incomeSatang: Satang, savingSatang: Satang): number | null {
  if (incomeSatang <= 0) return null;
  return Math.max(0, Math.round((savingSatang * 10_000) / incomeSatang));
}

/** Average monthly expense over periods that had any activity (null when there is no history). */
export function averageMonthlyExpense(periodExpenses: readonly Satang[]): Satang | null {
  const active = periodExpenses.filter((e) => e > 0);
  if (active.length === 0) return null;
  return Math.round(active.reduce((s, e) => s + e, 0) / active.length);
}

/** months × average expense, rounded UP to a whole ฿1,000 so the target reads cleanly. */
export function emergencyFundTarget(avgMonthlyExpense: Satang, months = EMERGENCY_MONTHS): Satang {
  const raw = avgMonthlyExpense * months;
  return Math.ceil(raw / 100_000) * 100_000;
}

/** Whole-baht share of an amount (never rounds up past what the user has). */
export function percentOf(amount: Satang, percent: number): Satang {
  return Math.floor((amount * percent) / 100 / 100) * 100;
}

export type LadderStep = 1 | 2 | 3 | 4;

export function currentStep(input: { emergencySaved: Satang; emergencyTarget: Satang | null; savingsRateBp: number | null; openGoals: number }): LadderStep {
  if (input.emergencyTarget === null || input.emergencySaved < input.emergencyTarget) return 1;
  if (input.savingsRateBp === null || input.savingsRateBp < TARGET_SAVINGS_RATE_BP) return 2;
  if (input.openGoals > 0) return 3;
  return 4;
}

const EMERGENCY_NAME = /ฉุกเฉิน|สำรอง|emergency/i;
export const EMERGENCY_GOAL_NAME = 'เงินสำรองฉุกเฉิน';
export function isEmergencyGoalName(name: string): boolean {
  return EMERGENCY_NAME.test(name);
}
