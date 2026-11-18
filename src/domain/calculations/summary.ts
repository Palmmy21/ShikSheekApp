/**
 * Period totals from transactions. Pure, deterministic, integer satang only.
 */
import type { LocalDate } from '../dates.ts';
import type { Transaction, TransactionType } from '../entities/index.ts';
import { assertSatang, type Satang } from '../money.ts';

export interface DateRange {
  start: LocalDate; // inclusive
  end: LocalDate; // inclusive
}

export interface CategoryTotal {
  categoryId: string;
  amountSatang: Satang;
  count: number;
}

export interface PeriodTotals {
  incomeSatang: Satang;
  expenseSatang: Satang;
  /** Money moved into savings goals. Not an "expense" in reports, but it leaves spendable cash. */
  savingSatang: Satang;
  /** income - expense - saving */
  netSatang: Satang;
  transactionCount: number;
  expenseByCategory: CategoryTotal[]; // sorted desc by amount
  incomeByCategory: CategoryTotal[]; // sorted desc by amount
}

export function isActive(t: Pick<Transaction, 'deletedAt'>): boolean {
  return t.deletedAt === null;
}

export function inRange(date: LocalDate, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

export function filterTransactions(txns: readonly Transaction[], range: DateRange, type?: TransactionType): Transaction[] {
  return txns.filter((t) => isActive(t) && inRange(t.txnDate, range) && (type === undefined || t.type === type));
}

function groupByCategory(txns: readonly Transaction[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of txns) {
    const row = map.get(t.categoryId) ?? { categoryId: t.categoryId, amountSatang: 0, count: 0 };
    row.amountSatang += t.amountSatang;
    row.count += 1;
    map.set(t.categoryId, row);
  }
  return [...map.values()].sort((a, b) => b.amountSatang - a.amountSatang || a.categoryId.localeCompare(b.categoryId));
}

export function summarizeTransactions(txns: readonly Transaction[], range: DateRange): PeriodTotals {
  const active = filterTransactions(txns, range);
  let income = 0;
  let expense = 0;
  let saving = 0;
  const expenses: Transaction[] = [];
  const incomes: Transaction[] = [];
  for (const t of active) {
    assertSatang(t.amountSatang);
    if (t.amountSatang <= 0) throw new RangeError(`Transaction ${t.id} has non-positive amount`);
    if (t.type === 'income') {
      income += t.amountSatang;
      incomes.push(t);
    } else if (t.type === 'expense') {
      expense += t.amountSatang;
      expenses.push(t);
    } else {
      saving += t.amountSatang;
    }
  }
  const net = income - expense - saving;
  assertSatang(net, 'net');
  return {
    incomeSatang: income,
    expenseSatang: expense,
    savingSatang: saving,
    netSatang: net,
    transactionCount: active.length,
    expenseByCategory: groupByCategory(expenses),
    incomeByCategory: groupByCategory(incomes),
  };
}

/** Expense per calendar day across the range (zero-filled), for charts. */
export function dailyExpenseSeries(txns: readonly Transaction[], range: DateRange): Array<{ date: LocalDate; expenseSatang: Satang }> {
  const byDay = new Map<string, Satang>();
  for (const t of filterTransactions(txns, range, 'expense')) byDay.set(t.txnDate, (byDay.get(t.txnDate) ?? 0) + t.amountSatang);
  const out: Array<{ date: LocalDate; expenseSatang: Satang }> = [];
  for (let d = range.start; d <= range.end; d = nextDay(d)) out.push({ date: d, expenseSatang: byDay.get(d) ?? 0 });
  return out;
}

function nextDay(d: LocalDate): LocalDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

export function expenseByCategoryMap(txns: readonly Transaction[], range: DateRange): Map<string, Satang> {
  const map = new Map<string, Satang>();
  for (const t of filterTransactions(txns, range, 'expense')) {
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amountSatang);
  }
  return map;
}
