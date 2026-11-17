/**
 * Budget utilisation and threshold alerts. Percentages are integer basis points (1% = 100).
 */
import { TOTAL_BUDGET_CATEGORY, type Budget } from '../entities/index.ts';
import { ratioBasisPoints, type Satang } from '../money.ts';

export const DEFAULT_ALERT_THRESHOLDS = [50, 80, 100] as const; // percent

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetStatus {
  budget: Budget;
  spentSatang: Satang;
  remainingSatang: Satang; // may be negative
  usedBasisPoints: number;
  level: BudgetLevel;
}

export function budgetLevel(usedBp: number): BudgetLevel {
  if (usedBp >= 10_000) return 'exceeded';
  if (usedBp >= 8_000) return 'warning';
  return 'ok';
}

export function spentForBudget(
  budget: Pick<Budget, 'categoryId'>,
  expenseByCategory: ReadonlyMap<string, Satang>,
): Satang {
  if (budget.categoryId === TOTAL_BUDGET_CATEGORY) {
    let total = 0;
    for (const v of expenseByCategory.values()) total += v;
    return total;
  }
  return expenseByCategory.get(budget.categoryId) ?? 0;
}

export function computeBudgetStatus(budget: Budget, spentSatang: Satang): BudgetStatus {
  if (budget.limitSatang <= 0) throw new RangeError('Budget limit must be positive');
  const used = ratioBasisPoints(spentSatang, budget.limitSatang);
  return {
    budget,
    spentSatang,
    remainingSatang: budget.limitSatang - spentSatang,
    usedBasisPoints: used,
    level: budgetLevel(used),
  };
}

export function computeBudgetStatuses(
  budgets: readonly Budget[],
  expenseByCategory: ReadonlyMap<string, Satang>,
): BudgetStatus[] {
  return budgets
    .map((b) => computeBudgetStatus(b, spentForBudget(b, expenseByCategory)))
    .sort((a, b) => b.usedBasisPoints - a.usedBasisPoints);
}

/**
 * Thresholds (in percent) reached by `usedBp` that have not been alerted yet this period.
 * Callers persist the returned thresholds so each alert fires at most once per budget per period.
 */
export function newlyCrossedThresholds(
  usedBp: number,
  alreadyAlerted: readonly number[],
  thresholds: readonly number[] = DEFAULT_ALERT_THRESHOLDS,
): number[] {
  return thresholds.filter((t) => usedBp >= t * 100 && !alreadyAlerted.includes(t)).sort((a, b) => a - b);
}
