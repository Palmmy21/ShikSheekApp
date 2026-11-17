/**
 * Read models for dashboard, reports, budgets and savings. Loads data, delegates all math to
 * src/domain/calculations, and returns plain pre-calculated view data for the presenters.
 */
import { calculateAvailable, type AvailableBreakdown } from '../../domain/calculations/available.ts';
import { upcomingBills, type OccurrenceView } from '../../domain/calculations/bills.ts';
import {
  computeBudgetStatuses,
  newlyCrossedThresholds,
  type BudgetStatus,
} from '../../domain/calculations/budget.ts';
import { computeSavingsProgress, type SavingsProgress } from '../../domain/calculations/savings.ts';
import { expenseByCategoryMap, summarizeTransactions, type PeriodTotals } from '../../domain/calculations/summary.ts';
import { addDays, diffDays, startOfIsoWeek, type LocalDate } from '../../domain/dates.ts';
import { getCategory, isKnownCategory } from '../../domain/entities/categories.ts';
import { TOTAL_BUDGET_CATEGORY, type Budget, type SavingsGoal, type UserProfile } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { periodForDate, periodFromKey, previousPeriod, type Period } from '../../domain/period.ts';
import { createRepos, type Repos } from '../../infrastructure/db/repositories/index.ts';
import type { Sql } from '../../infrastructure/db/sql.ts';
import { createFixedCostService, GENERATION_HORIZON_DAYS } from './fixed-cost-service.ts';
import { ValidationError } from './transaction-service.ts';

export interface DashboardView {
  user: UserProfile;
  period: Period;
  today: LocalDate;
  available: AvailableBreakdown;
  totals: PeriodTotals;
  todayExpenseSatang: Satang;
  upcomingBills: OccurrenceView[];
  fixedCostNames: Record<string, string>;
  budgets: BudgetStatus[];
}

export interface SummaryView {
  label: 'day' | 'week' | 'month';
  start: LocalDate;
  end: LocalDate;
  totals: PeriodTotals;
  previousTotals: PeriodTotals | null;
  /** expense change vs the previous equivalent range, in satang (positive = spent more) */
  expenseChangeSatang: Satang | null;
  available: AvailableBreakdown | null;
  budgets: BudgetStatus[];
  topExpenseNote: string | null;
}

export interface BudgetAlert {
  status: BudgetStatus;
  threshold: number;
}

export function createFinanceService(sql: Sql, repos: Repos = createRepos(sql)) {
  const fixedCosts = createFixedCostService(sql, repos);

  async function requireUser(userId: string): Promise<UserProfile> {
    const user = await repos.users.get(userId);
    if (!user) throw new Error('user not found');
    return user;
  }

  async function availableFor(user: UserProfile, period: Period, today: LocalDate) {
    // Make sure this period's bills exist before computing (idempotent).
    await fixedCosts.generateForUser(user.userId, addDays(maxOf(period.end, today), GENERATION_HORIZON_DAYS));
    const [txns, savings, occurrences, goals] = await Promise.all([
      repos.transactions.listByRange(user.userId, period.start, period.end),
      repos.transactions.listSavings(user.userId),
      repos.fixedCosts.listOccurrencesForPeriod(user.userId, period.start, addDays(maxOf(period.end, today), GENERATION_HORIZON_DAYS)),
      repos.goals.listActive(user.userId),
    ]);
    const available = calculateAvailable({ period, today, transactions: txns, occurrences, savingsGoals: goals });
    return { txns, savings, occurrences, goals, available };
  }

  async function budgetStatuses(userId: string, period: Period, txnsInPeriod?: Awaited<ReturnType<Repos['transactions']['listByRange']>>) {
    const budgets = await repos.budgets.list(userId);
    if (budgets.length === 0) return [];
    const txns = txnsInPeriod ?? (await repos.transactions.listByRange(userId, period.start, period.end));
    return computeBudgetStatuses(budgets, expenseByCategoryMap(txns, { start: period.start, end: period.end }));
  }

  const service = {
    periodFor(user: UserProfile, today: LocalDate): Period {
      return periodForDate(today, user.cycleStartDay);
    },

    async dashboard(userId: string, today: LocalDate): Promise<DashboardView> {
      const user = await requireUser(userId);
      const period = periodForDate(today, user.cycleStartDay);
      const { txns, occurrences, available } = await availableFor(user, period, today);
      const totals = summarizeTransactions(txns, { start: period.start, end: period.end });
      const todayTotals = summarizeTransactions(txns, { start: today, end: today });
      const bills = upcomingBills(occurrences, today, 7);
      const costs = await repos.fixedCosts.list(userId);
      return {
        user,
        period,
        today,
        available,
        totals,
        todayExpenseSatang: todayTotals.expenseSatang,
        upcomingBills: bills,
        fixedCostNames: Object.fromEntries(costs.map((c) => [c.id, c.name])),
        budgets: await budgetStatuses(userId, period, txns),
      };
    },

    async upcoming(userId: string, today: LocalDate, withinDays: number) {
      const user = await requireUser(userId);
      await fixedCosts.generateForUser(userId, addDays(today, GENERATION_HORIZON_DAYS));
      const occ = await repos.fixedCosts.listOccurrencesForPeriod(userId, today, addDays(today, withinDays));
      const costs = await repos.fixedCosts.list(user.userId);
      return {
        bills: upcomingBills(occ, today, withinDays),
        fixedCostNames: Object.fromEntries(costs.map((c) => [c.id, c.name])) as Record<string, string>,
      };
    },

    async daySummary(userId: string, date: LocalDate): Promise<SummaryView> {
      const user = await requireUser(userId);
      const period = periodForDate(date, user.cycleStartDay);
      const { txns, available } = await availableFor(user, period, date);
      const totals = summarizeTransactions(txns, { start: date, end: date });
      const prevDay = addDays(date, -1);
      const prevTxns = prevDay < period.start ? await repos.transactions.listByRange(userId, prevDay, prevDay) : txns;
      const previousTotals = summarizeTransactions(prevTxns, { start: prevDay, end: prevDay });
      const top = txns.filter((t) => t.txnDate === date && t.type === 'expense').sort((a, b) => b.amountSatang - a.amountSatang)[0];
      return {
        label: 'day',
        start: date,
        end: date,
        totals,
        previousTotals,
        expenseChangeSatang: totals.expenseSatang - previousTotals.expenseSatang,
        available,
        budgets: await budgetStatuses(userId, period, txns),
        topExpenseNote: top ? top.note ?? getCategory(top.categoryId).labelTh : null,
      };
    },

    async weekSummary(userId: string, today: LocalDate): Promise<SummaryView> {
      await requireUser(userId);
      const start = startOfIsoWeek(today);
      const prevStart = addDays(start, -7);
      const txns = await repos.transactions.listByRange(userId, prevStart, today);
      const totals = summarizeTransactions(txns, { start, end: today });
      // compare with the same number of days of last week
      const elapsed = diffDays(start, today);
      const previousTotals = summarizeTransactions(txns, { start: prevStart, end: addDays(prevStart, elapsed) });
      return {
        label: 'week',
        start,
        end: today,
        totals,
        previousTotals,
        expenseChangeSatang: totals.expenseSatang - previousTotals.expenseSatang,
        available: null,
        budgets: [],
        topExpenseNote: null,
      };
    },

    async monthSummary(userId: string, today: LocalDate, periodKey?: string): Promise<SummaryView> {
      const user = await requireUser(userId);
      const period = periodKey ? periodFromKey(periodKey, user.cycleStartDay) : periodForDate(today, user.cycleStartDay);
      const prev = previousPeriod(period);
      const asOf = today < period.end ? today : period.end;
      const { txns, available } = await availableFor(user, period, asOf);
      const prevTxns = await repos.transactions.listByRange(userId, prev.start, prev.end);
      const totals = summarizeTransactions(txns, { start: period.start, end: period.end });
      const previousTotals = summarizeTransactions(prevTxns, { start: prev.start, end: prev.end });
      return {
        label: 'month',
        start: period.start,
        end: period.end,
        totals,
        previousTotals,
        expenseChangeSatang: totals.expenseSatang - previousTotals.expenseSatang,
        available,
        budgets: await budgetStatuses(userId, period, txns),
        topExpenseNote: null,
      };
    },

    // ── budgets ──
    async budgets(userId: string, today: LocalDate): Promise<{ period: Period; statuses: BudgetStatus[] }> {
      const user = await requireUser(userId);
      const period = periodForDate(today, user.cycleStartDay);
      return { period, statuses: await budgetStatuses(userId, period) };
    },

    async setBudget(userId: string, categoryId: string, limitSatang: Satang): Promise<Budget> {
      if (categoryId !== TOTAL_BUDGET_CATEGORY && (!isKnownCategory(categoryId) || getCategory(categoryId).kind !== 'expense')) {
        throw new ValidationError('category', 'ตั้งงบได้เฉพาะหมวดรายจ่าย');
      }
      if (!isValidPositiveAmount(limitSatang)) throw new ValidationError('amount', 'จำนวนเงินไม่ถูกต้อง');
      return repos.budgets.upsert(userId, categoryId, limitSatang);
    },

    async deleteBudget(userId: string, budgetId: string): Promise<boolean> {
      return repos.budgets.delete(userId, budgetId);
    },

    /**
     * After an expense is saved: thresholds newly crossed this period, recorded so each fires once.
     * Respects the user's budget-alert preference.
     */
    async budgetAlertsFor(userId: string, today: LocalDate, categoryId: string): Promise<BudgetAlert[]> {
      const user = await requireUser(userId);
      if (!user.notifications.budgetAlerts) return [];
      const period = periodForDate(today, user.cycleStartDay);
      const statuses = (await budgetStatuses(userId, period)).filter(
        (s) => s.budget.categoryId === categoryId || s.budget.categoryId === TOTAL_BUDGET_CATEGORY,
      );
      const alerts: BudgetAlert[] = [];
      for (const s of statuses) {
        const already = await repos.budgets.alertedThresholds(s.budget.id, period.start);
        const crossed = newlyCrossedThresholds(s.usedBasisPoints, already);
        if (crossed.length === 0) continue;
        // record all crossed thresholds, notify only the highest
        let recordedAny = false;
        for (const t of crossed) recordedAny = (await repos.budgets.recordAlert(userId, s.budget.id, period.start, t)) || recordedAny;
        if (recordedAny) alerts.push({ status: s, threshold: crossed[crossed.length - 1]! });
      }
      return alerts;
    },

    // ── savings goals ──
    async goals(userId: string): Promise<SavingsProgress[]> {
      const [goals, savings] = await Promise.all([repos.goals.listActive(userId), repos.transactions.listSavings(userId)]);
      return goals.map((g) => computeSavingsProgress(g, savings));
    },

    async goalProgress(userId: string, goalId: string): Promise<SavingsProgress | null> {
      const goal = await repos.goals.get(userId, goalId);
      if (!goal) return null;
      return computeSavingsProgress(goal, await repos.transactions.listSavings(userId));
    },

    async createGoal(userId: string, input: { name: string; targetSatang: Satang; monthlyReserveSatang: Satang }): Promise<SavingsGoal> {
      const name = input.name.trim();
      if (!name || name.length > 60) throw new ValidationError('name', 'ชื่อเป้าหมายต้องยาว 1-60 ตัวอักษร');
      if (!isValidPositiveAmount(input.targetSatang)) throw new ValidationError('amount', 'เป้าหมายไม่ถูกต้อง');
      if (input.monthlyReserveSatang < 0 || !Number.isSafeInteger(input.monthlyReserveSatang)) {
        throw new ValidationError('amount', 'ยอดออมต่อเดือนไม่ถูกต้อง');
      }
      return repos.goals.insert({ userId, name, targetSatang: input.targetSatang, monthlyReserveSatang: input.monthlyReserveSatang, targetDate: null });
    },

    async archiveGoal(userId: string, goalId: string): Promise<boolean> {
      return repos.goals.setStatus(userId, goalId, 'archived');
    },
  };
  return service;
}

function maxOf(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

export type FinanceService = ReturnType<typeof createFinanceService>;
