/**
 * Screens shared by text queries and postback buttons. Each loads pre-calculated data from services
 * and renders a template — no financial math here.
 */
import { addDays, formatThaiShort } from '../../../domain/dates.ts';
import { previousPeriod } from '../../../domain/period.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import type { Transaction } from '../../../domain/entities/index.ts';
import { ValidationError, type TransactionDraft } from '../../../application/services/transaction-service.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import type { Situation } from '../../../application/personality/rule-based.ts';
import type { HandlerContext } from '../context.ts';
import { moodForSavedTransaction, type MascotExpression } from '../mascot.ts';
import { mascotSays } from '../flex/common.ts';
import { budgetsOverviewMessage, budgetWarningMessage, goalsOverviewMessage } from '../flex/budgets-goals.ts';
import { dashboardMessage, reportsMenuMessage, summaryMessage } from '../flex/dashboard-reports.ts';
import { fixedCostOverviewMessage, upcomingBillsMessage } from '../flex/fixed-costs.ts';
import { categoryPickerMessage, confirmTransactionMessage, historyMessage, transactionSavedMessage } from '../flex/transactions.ts';
import { pb } from '../flex/actions.ts';

export async function showDashboard(ctx: HandlerContext): Promise<Message[]> {
  const v = await ctx.deps.finance.dashboard(ctx.userId, ctx.today);
  const a = v.available;
  const situation: Situation = !a.hasIncome ? 'no_income_yet' : a.isNegative ? 'balance_negative' : a.availableSatang * 10 < a.incomeSatang ? 'balance_tight' : 'balance_healthy';
  return [dashboardMessage(v, await ctx.deps.personality.comment(situation, ctx.today))];
}

export async function showDaySummary(ctx: HandlerContext, date = ctx.today): Promise<Message[]> {
  const v = await ctx.deps.finance.daySummary(ctx.userId, date);
  const none = v.totals.expenseSatang === 0;
  const situation: Situation = none ? 'daily_none' : (v.expenseChangeSatang ?? 0) < 0 ? 'spent_less_than_before' : 'daily_spent';
  const mascot: MascotExpression = none ? 'proud' : v.available?.isNegative ? 'worried' : 'happy';
  return [summaryMessage(v, await ctx.deps.personality.comment(situation, date), mascot)];
}

export async function showWeekSummary(ctx: HandlerContext): Promise<Message[]> {
  const v = await ctx.deps.finance.weekSummary(ctx.userId, ctx.today);
  const situation: Situation = (v.expenseChangeSatang ?? 0) > 0 ? 'spent_more_than_before' : 'spent_less_than_before';
  return [summaryMessage(v, await ctx.deps.personality.comment(situation, v.start), (v.expenseChangeSatang ?? 0) > 0 ? 'worried' : 'proud')];
}

export async function showMonthSummary(ctx: HandlerContext, periodKey?: string): Promise<Message[]> {
  const v = await ctx.deps.finance.monthSummary(ctx.userId, ctx.today, periodKey);
  const more = (v.expenseChangeSatang ?? 0) > 0;
  const mascot: MascotExpression = v.available?.isNegative ? 'shocked' : more ? 'worried' : 'proud';
  return [summaryMessage(v, await ctx.deps.personality.comment(more ? 'spent_more_than_before' : 'spent_less_than_before', v.start), mascot)];
}

export async function showReportsMenu(ctx: HandlerContext): Promise<Message[]> {
  const user = await ctx.deps.repos.users.get(ctx.userId);
  const period = ctx.deps.finance.periodFor(user!, ctx.today);
  return [reportsMenuMessage(previousPeriod(period).key)];
}

export async function showFixedCosts(ctx: HandlerContext): Promise<Message[]> {
  await ctx.deps.fixedCosts.generateForUser(ctx.userId, addDays(ctx.today, 45));
  return [fixedCostOverviewMessage(await ctx.deps.fixedCosts.list(ctx.userId, ctx.today))];
}

export async function showUpcomingBills(ctx: HandlerContext, withinDays = 7, fromDate = ctx.today): Promise<Message[]> {
  const { bills, fixedCostNames } = await ctx.deps.finance.upcoming(ctx.userId, ctx.today, Math.max(withinDays, 0) + (fromDate > ctx.today ? 1 : 0));
  const selected = fromDate > ctx.today ? bills.filter((b) => b.dueDate === fromDate) : bills;
  const title = fromDate > ctx.today ? `${formatThaiShort(fromDate)} ต้องจ่าย` : `ภายใน ${withinDays} วัน`;
  return [upcomingBillsMessage(selected, fixedCostNames, title)];
}

export async function showBudgets(ctx: HandlerContext): Promise<Message[]> {
  const { period, statuses } = await ctx.deps.finance.budgets(ctx.userId, ctx.today);
  return [budgetsOverviewMessage(statuses, `${formatThaiShort(period.start)} – ${formatThaiShort(period.end)}`)];
}

export async function showGoals(ctx: HandlerContext): Promise<Message[]> {
  return [goalsOverviewMessage(await ctx.deps.finance.goals(ctx.userId))];
}

export async function showHistory(ctx: HandlerContext, page: number): Promise<Message[]> {
  const { items, hasMore } = await ctx.deps.txns.history(ctx.userId, page);
  return [historyMessage(items, page, hasMore, ctx.today)];
}

/** Create a draft and show the confirmation card (+ category picker when unsure). */
export async function proposeTransaction(ctx: HandlerContext, draft: TransactionDraft): Promise<Message[]> {
  try {
    const pending = await ctx.deps.txns.createDraft(ctx.userId, draft, ctx.today);
    let goalName: string | undefined;
    if (draft.savingsGoalId) goalName = (await ctx.deps.repos.goals.get(ctx.userId, draft.savingsGoalId))?.name;
    const messages: Message[] = [confirmTransactionMessage(pending.id, draft, ctx.today, goalName)];
    if (!draft.categoryConfident && draft.type !== 'saving') messages.push(categoryPickerMessage(pending.id, draft.type));
    return messages;
  } catch (e) {
    if (e instanceof ValidationError) return [mascotSays(`${e.message} ลองใหม่อีกครั้งนะ`, 'thinking')];
    throw e;
  }
}

/** Success card + any budget alerts + onboarding completion. */
export async function afterTransactionSaved(ctx: HandlerContext, t: Transaction): Promise<Message[]> {
  const dash = await ctx.deps.finance.dashboard(ctx.userId, ctx.today);
  const big = t.type === 'expense' && t.amountSatang >= 500_000;
  const situation: Situation = t.type === 'income' ? 'saved_income' : t.type === 'saving' ? 'saved_saving' : big ? 'saved_expense_big' : 'saved_expense';
  const messages: Message[] = [
    transactionSavedMessage(t, ctx.today, await ctx.deps.personality.comment(situation, t.id), moodForSavedTransaction(t.type, t.amountSatang), {
      todayExpenseSatang: dash.todayExpenseSatang,
      availableSatang: dash.available.availableSatang,
      dailyAllowanceSatang: dash.available.dailyAllowanceSatang,
    }),
  ];
  if (t.type === 'expense') {
    for (const alert of await ctx.deps.finance.budgetAlertsFor(ctx.userId, ctx.today, t.categoryId)) {
      const sit: Situation = alert.threshold >= 100 ? 'budget_exceeded' : 'budget_warning';
      messages.push(budgetWarningMessage(alert.status, alert.threshold, await ctx.deps.personality.comment(sit, `${alert.status.budget.id}:${alert.threshold}`)));
    }
  }
  if (t.type === 'saving' && t.savingsGoalId) {
    const progress = await ctx.deps.finance.goalProgress(ctx.userId, t.savingsGoalId);
    if (progress?.isReached && progress.savedSatang - t.amountSatang < progress.goal.targetSatang) {
      messages.push(mascotSays(`${await ctx.deps.personality.comment('goal_reached', t.id)}\n🎯 ${progress.goal.name}`, 'celebrating'));
    }
  }
  const user = await ctx.deps.repos.users.get(ctx.userId);
  if (user && user.onboarding !== 'done') {
    await ctx.deps.repos.users.setOnboarding(ctx.userId, 'done');
    if (t.type === 'income') messages.push(mascotSays('ตั้งค่าเสร็จแล้ว! ลองกดเมนู "ภาพรวม" ดูยอดใช้ได้จริงของเดือนนี้ได้เลย 🎉', 'celebrating', [pb('ภาพรวม', 'dashboard')]));
  }
  return messages.slice(0, 5);
}

export function categoryLabel(id: string): string {
  const c = getCategory(id);
  return `${c.emoji} ${c.labelTh}`;
}
