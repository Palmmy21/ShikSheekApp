import type {
  FixedCost,
  FixedCostOccurrence,
  SavingsGoal,
  Transaction,
} from '../../src/domain/entities/index.ts';

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export const USER = 'U00000000000000000000000000000001';

export function txn(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'amountSatang' | 'txnDate'>): Transaction {
  return {
    id: nextId('t'),
    userId: USER,
    categoryId: partial.type === 'income' ? 'salary' : partial.type === 'saving' ? 'savings' : 'food',
    note: null,
    source: 'chat',
    fixedCostOccurrenceId: null,
    savingsGoalId: null,
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    ...partial,
  };
}

export const income = (amountSatang: number, txnDate: string, extra: Partial<Transaction> = {}) =>
  txn({ type: 'income', amountSatang, txnDate, ...extra });
export const expense = (amountSatang: number, txnDate: string, extra: Partial<Transaction> = {}) =>
  txn({ type: 'expense', amountSatang, txnDate, ...extra });
export const saving = (amountSatang: number, txnDate: string, savingsGoalId: string, extra: Partial<Transaction> = {}) =>
  txn({ type: 'saving', amountSatang, txnDate, savingsGoalId, ...extra });

export function occurrence(partial: Partial<FixedCostOccurrence> & Pick<FixedCostOccurrence, 'dueDate' | 'amountSatang'>): FixedCostOccurrence {
  return {
    id: nextId('o'),
    userId: USER,
    fixedCostId: 'fc-1',
    occurrenceKey: `M${partial.dueDate.slice(0, 7)}`,
    status: 'pending',
    ...partial,
  };
}

export function fixedCost(partial: Partial<FixedCost> = {}): FixedCost {
  return {
    id: 'fc-1',
    userId: USER,
    name: 'ค่าเน็ต',
    amountSatang: 59_900,
    categoryId: 'bills',
    frequency: 'monthly',
    interval: 1,
    anchorDate: '2026-01-05',
    endDate: null,
    remindDaysBefore: 1,
    status: 'active',
    activeFrom: '2026-01-01',
    ...partial,
  };
}

export function goal(partial: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: nextId('g'),
    userId: USER,
    name: 'เที่ยวญี่ปุ่น',
    targetSatang: 3_000_000,
    monthlyReserveSatang: 0,
    targetDate: null,
    status: 'active',
    ...partial,
  };
}
