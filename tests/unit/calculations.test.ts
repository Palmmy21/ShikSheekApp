import { describe, expect, it } from 'vitest';
import { calculateAvailable, savingsReservationFor } from '../../src/domain/calculations/available.ts';
import { billsToRemind, upcomingBills } from '../../src/domain/calculations/bills.ts';
import {
  computeBudgetStatus,
  computeBudgetStatuses,
  newlyCrossedThresholds,
} from '../../src/domain/calculations/budget.ts';
import { computeSavingsProgress } from '../../src/domain/calculations/savings.ts';
import { expenseByCategoryMap, summarizeTransactions } from '../../src/domain/calculations/summary.ts';
import { TOTAL_BUDGET_CATEGORY, type Budget } from '../../src/domain/entities/index.ts';
import { periodFromKey } from '../../src/domain/period.ts';
import { expense, fixedCost, goal, income, occurrence, saving, USER } from '../helpers/fixtures.ts';

const NOV = periodFromKey('2026-11');
const range = { start: NOV.start, end: NOV.end };

describe('summarizeTransactions', () => {
  it('totals income, expense and saving within the range only', () => {
    const t = summarizeTransactions(
      [
        income(2_500_000, '2026-11-01'),
        expense(6_500, '2026-11-18'),
        expense(50_000, '2026-11-18', { categoryId: 'transport' }),
        expense(8_000, '2026-11-30'),
        expense(99_999, '2026-10-31'), // previous period
        expense(99_999, '2026-12-01'), // next period
        saving(100_000, '2026-11-02', 'g1'),
      ],
      range,
    );
    expect(t.incomeSatang).toBe(2_500_000);
    expect(t.expenseSatang).toBe(64_500);
    expect(t.savingSatang).toBe(100_000);
    expect(t.netSatang).toBe(2_500_000 - 64_500 - 100_000);
    expect(t.transactionCount).toBe(5);
    expect(t.expenseByCategory).toEqual([
      { categoryId: 'transport', amountSatang: 50_000, count: 1 },
      { categoryId: 'food', amountSatang: 14_500, count: 2 },
    ]);
  });

  it('ignores soft-deleted transactions', () => {
    const t = summarizeTransactions([expense(6_500, '2026-11-18', { deletedAt: '2026-11-18T10:00:00Z' })], range);
    expect(t.expenseSatang).toBe(0);
    expect(t.transactionCount).toBe(0);
  });

  it('handles an empty period (zero everything)', () => {
    const t = summarizeTransactions([], range);
    expect(t).toMatchObject({ incomeSatang: 0, expenseSatang: 0, savingSatang: 0, netSatang: 0, transactionCount: 0 });
  });

  it('many small transactions in the same period stay exact', () => {
    const txns = Array.from({ length: 1_000 }, () => expense(1, '2026-11-15')); // 1 satang each
    expect(summarizeTransactions(txns, range).expenseSatang).toBe(1_000);
    const coffee = Array.from({ length: 30 }, () => expense(4_550, '2026-11-15')); // ฿45.50 x 30
    expect(summarizeTransactions(coffee, range).expenseSatang).toBe(136_500);
  });

  it('rejects corrupted amounts', () => {
    expect(() => summarizeTransactions([expense(10.5, '2026-11-01')], range)).toThrow();
    expect(() => summarizeTransactions([expense(-100, '2026-11-01')], range)).toThrow();
  });

  it('expenseByCategoryMap only counts expenses', () => {
    const map = expenseByCategoryMap(
      [expense(100, '2026-11-01'), income(500, '2026-11-01', { categoryId: 'food' }), saving(300, '2026-11-01', 'g')],
      range,
    );
    expect(map.get('food')).toBe(100);
    expect(map.size).toBe(1);
  });
});

describe('calculateAvailable', () => {
  const base = { period: NOV, today: '2026-11-18', occurrences: [], savingsGoals: [] };

  it('income minus expenses', () => {
    const r = calculateAvailable({ ...base, transactions: [income(2_500_000, '2026-11-01'), expense(500_000, '2026-11-10')] });
    expect(r.availableSatang).toBe(2_000_000);
    expect(r.hasIncome).toBe(true);
    expect(r.isNegative).toBe(false);
  });

  it('deducts UNPAID fixed costs due in the period', () => {
    const r = calculateAvailable({
      ...base,
      transactions: [income(2_500_000, '2026-11-01')],
      occurrences: [occurrence({ dueDate: '2026-11-25', amountSatang: 800_000 }), occurrence({ dueDate: '2026-11-05', amountSatang: 59_900 })],
    });
    expect(r.unpaidFixedCostsSatang).toBe(859_900);
    expect(r.unpaidFixedCostCount).toBe(2);
    expect(r.availableSatang).toBe(2_500_000 - 859_900);
  });

  it('PAID fixed costs are deducted exactly once (via their expense transaction)', () => {
    const rent = occurrence({ dueDate: '2026-11-01', amountSatang: 800_000, status: 'paid' });
    const r = calculateAvailable({
      ...base,
      transactions: [
        income(2_500_000, '2026-11-01'),
        expense(800_000, '2026-11-01', { categoryId: 'bills', fixedCostOccurrenceId: rent.id, source: 'fixed_cost' }),
      ],
      occurrences: [rent],
    });
    expect(r.expenseSatang).toBe(800_000);
    expect(r.paidFixedCostsSatang).toBe(800_000);
    expect(r.unpaidFixedCostsSatang).toBe(0);
    expect(r.availableSatang).toBe(1_700_000);
  });

  it('does not double count even if the occurrence status lags behind its payment', () => {
    const rent = occurrence({ dueDate: '2026-11-01', amountSatang: 800_000, status: 'pending' });
    const r = calculateAvailable({
      ...base,
      transactions: [income(2_500_000, '2026-11-01'), expense(800_000, '2026-11-01', { fixedCostOccurrenceId: rent.id })],
      occurrences: [rent],
    });
    expect(r.availableSatang).toBe(1_700_000);
  });

  it('a paid amount different from the planned amount uses the actual payment', () => {
    const elec = occurrence({ dueDate: '2026-11-10', amountSatang: 150_000, status: 'paid' });
    const r = calculateAvailable({
      ...base,
      transactions: [income(2_500_000, '2026-11-01'), expense(173_250, '2026-11-10', { fixedCostOccurrenceId: elec.id })],
      occurrences: [elec],
    });
    expect(r.availableSatang).toBe(2_500_000 - 173_250);
  });

  it('includes overdue unpaid bills from earlier periods, excludes future and skipped ones', () => {
    const r = calculateAvailable({
      ...base,
      transactions: [income(1_000_000, '2026-11-01')],
      occurrences: [
        occurrence({ dueDate: '2026-10-25', amountSatang: 100_000 }), // overdue from October: still owed
        occurrence({ dueDate: '2026-12-01', amountSatang: 200_000 }), // next period
        occurrence({ dueDate: '2026-11-20', amountSatang: 300_000, status: 'skipped' }),
      ],
    });
    expect(r.unpaidFixedCostsSatang).toBe(100_000);
    expect(r.availableSatang).toBe(900_000);
  });

  it('missing income yields a negative balance, not an error', () => {
    const r = calculateAvailable({
      ...base,
      transactions: [expense(6_500, '2026-11-18')],
      occurrences: [occurrence({ dueDate: '2026-11-25', amountSatang: 59_900 })],
    });
    expect(r.hasIncome).toBe(false);
    expect(r.availableSatang).toBe(-66_400);
    expect(r.isNegative).toBe(true);
    expect(r.dailyAllowanceSatang).toBe(0);
  });

  it('zero expenses and no income is exactly zero', () => {
    const r = calculateAvailable({ ...base, transactions: [] });
    expect(r.availableSatang).toBe(0);
    expect(r.isNegative).toBe(false);
  });

  it('reserves savings until contributed, never double counting', () => {
    const trip = goal({ monthlyReserveSatang: 300_000 });
    const noReserve = goal({ monthlyReserveSatang: 0 });
    const archived = goal({ monthlyReserveSatang: 999_999, status: 'archived' });
    const inc = income(2_500_000, '2026-11-01');

    const none = calculateAvailable({ ...base, transactions: [inc], savingsGoals: [trip, noReserve, archived] });
    expect(none.savingsReservedSatang).toBe(300_000);
    expect(none.availableSatang).toBe(2_200_000);

    const partial = calculateAvailable({
      ...base,
      transactions: [inc, saving(100_000, '2026-11-05', trip.id)],
      savingsGoals: [trip],
    });
    expect(partial.savingContributedSatang).toBe(100_000);
    expect(partial.savingsReservedSatang).toBe(200_000);
    expect(partial.availableSatang).toBe(2_200_000); // same total effect

    const over = calculateAvailable({
      ...base,
      transactions: [inc, saving(500_000, '2026-11-05', trip.id)],
      savingsGoals: [trip],
    });
    expect(over.savingsReservedSatang).toBe(0);
    expect(over.availableSatang).toBe(2_000_000);

    // last period's contribution does not satisfy this period's reservation
    const lastMonth = calculateAvailable({
      ...base,
      transactions: [inc, saving(300_000, '2026-10-30', trip.id)],
      savingsGoals: [trip],
    });
    expect(lastMonth.savingsReservedSatang).toBe(300_000);
  });

  it('daily allowance = available / days remaining including today (floored)', () => {
    const r = calculateAvailable({ ...base, transactions: [income(1_000_000, '2026-11-01')] }); // 13 days left (18..30)
    expect(r.daysRemaining).toBe(13);
    expect(r.dailyAllowanceSatang).toBe(Math.floor(1_000_000 / 13));
  });

  it('works with payday cycles', () => {
    const p = periodFromKey('2026-10', 25); // 2026-10-25 .. 2026-11-24
    const r = calculateAvailable({
      period: p,
      today: '2026-11-18',
      transactions: [income(2_500_000, '2026-10-25'), expense(10_000, '2026-11-24'), expense(99_000, '2026-11-25')],
      occurrences: [],
      savingsGoals: [],
    });
    expect(r.availableSatang).toBe(2_490_000);
    expect(r.daysRemaining).toBe(7);
  });

  it('savingsReservationFor ignores non-active goals', () => {
    expect(savingsReservationFor(goal({ monthlyReserveSatang: 100, status: 'completed' }), 0)).toBe(0);
  });
});

describe('budgets', () => {
  const food: Budget = { id: 'b1', userId: USER, categoryId: 'food', limitSatang: 500_000 };
  const total: Budget = { id: 'b2', userId: USER, categoryId: TOTAL_BUDGET_CATEGORY, limitSatang: 1_000_000 };

  it('computes utilisation and level', () => {
    expect(computeBudgetStatus(food, 0)).toMatchObject({ usedBasisPoints: 0, level: 'ok', remainingSatang: 500_000 });
    expect(computeBudgetStatus(food, 399_999)).toMatchObject({ level: 'ok' });
    expect(computeBudgetStatus(food, 400_000)).toMatchObject({ usedBasisPoints: 8_000, level: 'warning' });
    expect(computeBudgetStatus(food, 500_000)).toMatchObject({ usedBasisPoints: 10_000, level: 'exceeded', remainingSatang: 0 });
    expect(computeBudgetStatus(food, 650_000)).toMatchObject({ usedBasisPoints: 13_000, remainingSatang: -150_000 });
  });

  it('total budget sums every expense category; sorted by usage', () => {
    const spent = new Map([
      ['food', 450_000],
      ['transport', 300_000],
    ]);
    const s = computeBudgetStatuses([total, food], spent);
    expect(s[0]!.budget.id).toBe('b1'); // 90%
    expect(s[1]).toMatchObject({ spentSatang: 750_000, usedBasisPoints: 7_500 });
  });

  it('threshold alerts fire once each, including several crossed at once', () => {
    expect(newlyCrossedThresholds(4_999, [])).toEqual([]);
    expect(newlyCrossedThresholds(5_000, [])).toEqual([50]);
    expect(newlyCrossedThresholds(8_500, [50])).toEqual([80]);
    expect(newlyCrossedThresholds(8_500, [50, 80])).toEqual([]);
    expect(newlyCrossedThresholds(12_000, [])).toEqual([50, 80, 100]);
  });

  it('rejects a non-positive limit', () => {
    expect(() => computeBudgetStatus({ ...food, limitSatang: 0 }, 10)).toThrow();
  });
});

describe('savings progress', () => {
  it('derives saved amount from saving transactions only', () => {
    const g = goal({ targetSatang: 1_000_000, monthlyReserveSatang: 200_000 });
    const p = computeSavingsProgress(g, [
      saving(300_000, '2026-10-01', g.id),
      saving(100_000, '2026-11-01', g.id),
      saving(999_999, '2026-11-01', 'other-goal'),
      saving(50_000, '2026-11-02', g.id, { deletedAt: '2026-11-03T00:00:00Z' }),
      expense(100_000, '2026-11-01'),
    ]);
    expect(p).toMatchObject({ savedSatang: 400_000, remainingSatang: 600_000, progressBasisPoints: 4_000, isReached: false, periodsToGoal: 3 });
  });

  it('caps progress at 100% and stops estimating once reached', () => {
    const g = goal({ targetSatang: 100_000, monthlyReserveSatang: 10_000 });
    const p = computeSavingsProgress(g, [saving(150_000, '2026-11-01', g.id)]);
    expect(p).toMatchObject({ progressBasisPoints: 10_000, isReached: true, remainingSatang: 0, periodsToGoal: null });
  });
});

describe('bill selection', () => {
  const fc = fixedCost({ remindDaysBefore: 3 });

  it('upcomingBills includes overdue and due-soon pending items only', () => {
    const list = upcomingBills(
      [
        occurrence({ dueDate: '2026-11-15', amountSatang: 1 }),
        occurrence({ dueDate: '2026-11-19', amountSatang: 2 }),
        occurrence({ dueDate: '2026-11-30', amountSatang: 3 }),
        occurrence({ dueDate: '2026-11-19', amountSatang: 4, status: 'paid' }),
      ],
      '2026-11-18',
      7,
    );
    expect(list.map((o) => [o.amountSatang, o.displayStatus, o.daysUntilDue])).toEqual([
      [1, 'overdue', -3],
      [2, 'upcoming', 1],
    ]);
  });

  it('billsToRemind: N days before, on the day, and the day after; skips paused costs', () => {
    const occ = (dueDate: string, fixedCostId = 'fc-1') => occurrence({ dueDate, amountSatang: 100, fixedCostId });
    const today = '2026-11-18';
    const picked = billsToRemind(
      [occ('2026-11-21'), occ('2026-11-18'), occ('2026-11-17'), occ('2026-11-20'), occ('2026-11-10'), occ('2026-11-21', 'fc-paused')],
      [fc, fixedCost({ id: 'fc-paused', status: 'paused', remindDaysBefore: 3 })],
      today,
    );
    expect(picked.map((o) => o.dueDate)).toEqual(['2026-11-17', '2026-11-18', '2026-11-21']);
  });
});
