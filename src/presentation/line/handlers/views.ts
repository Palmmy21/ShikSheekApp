/**
 * Screens shared by text queries and postback buttons. Each loads pre-calculated data from services
 * and renders a template — no financial math here.
 */
import { addDays, formatThaiShort } from '../../../domain/dates.ts';
import { previousPeriod } from '../../../domain/period.ts';
import { getCategory, isKnownCategory } from '../../../domain/entities/categories.ts';
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
import { categoryPickerMessage, confirmTransactionMessage, historyMessage, multiConfirmMessage, multiSavedMessage, transactionSavedMessage } from '../flex/transactions.ts';
import { formatBaht, sumSatang } from '../../../domain/money.ts';
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

/**
 * Auto-categorisation: (1) the user's own past corrections win; (2) when the rules are unsure and AI is
 * configured, ask it for a category (validated against the entry type). Amounts are never touched.
 */
export async function refineCategory(ctx: HandlerContext, draft: TransactionDraft): Promise<TransactionDraft> {
  if (draft.type === 'saving' || !draft.note) return draft;
  const learned = await ctx.deps.repos.categoryRules.match(ctx.userId, draft.note);
  if (learned && isKnownCategory(learned) && getCategory(learned).kind === draft.type) {
    return { ...draft, categoryId: learned, categoryConfident: true };
  }
  if (!draft.categoryConfident && ctx.deps.ai) {
    const intent = await ctx.deps.ai.interpret(draft.note).catch(() => null);
    const c = intent?.category_id;
    if (c && isKnownCategory(c) && getCategory(c).kind === draft.type) return { ...draft, categoryId: c, categoryConfident: true };
  }
  return draft;
}

/** Confident = safe to save without asking (auto-record mode). */
export function isConfident(d: TransactionDraft, today: string): boolean {
  return d.type !== 'saving' && d.categoryConfident && d.txnDate <= today;
}

/** Create a draft and show the confirmation card (+ category picker when unsure) — or save directly in auto-record mode. */
export async function proposeTransaction(ctx: HandlerContext, input: TransactionDraft): Promise<Message[]> {
  try {
    const draft = await refineCategory(ctx, input);
    const user = await ctx.deps.repos.users.get(ctx.userId);
    if (user?.autoRecord && isConfident(draft, ctx.today)) {
      const r = await ctx.deps.txns.saveDirect(ctx.userId, draft, ctx.today);
      if (r.status === 'saved') return afterTransactionSaved(ctx, r.transaction);
      if (r.status === 'duplicate') return [mascotSays('สลิป/รายการนี้จดไปแล้ว ชิกชิกไม่บันทึกซ้ำให้นะ', 'smart')];
      if (r.status === 'invalid') return [mascotSays(`${r.error.message} ลองใหม่อีกครั้งนะ`, 'thinking')];
    }
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

export const MULTI_SAVED_KIND = 'multi_saved';

function multiTotals(items: Array<{ type: string; amountSatang: number }>) {
  return {
    expenseSatang: sumSatang(items.filter((i) => i.type === 'expense').map((i) => i.amountSatang)),
    incomeSatang: sumSatang(items.filter((i) => i.type === 'income').map((i) => i.amountSatang)),
  };
}

/** Several items from one message: one confirm card — or, in auto-record mode with all items confident, save at once. */
export async function proposeMulti(ctx: HandlerContext, inputs: TransactionDraft[]): Promise<Message[]> {
  const drafts = await Promise.all(inputs.map((d) => refineCategory(ctx, d)));
  try {
    const user = await ctx.deps.repos.users.get(ctx.userId);
    if (user?.autoRecord && drafts.every((d) => isConfident(d, ctx.today))) {
      const saved = await ctx.deps.txns.saveManyDirect(ctx.userId, drafts, ctx.today);
      return afterMultiSaved(ctx, saved);
    }
    const pending = await ctx.deps.txns.createMultiDraft(ctx.userId, drafts, ctx.today);
    return [multiConfirmMessage(pending.id, drafts, ctx.today, multiTotals(drafts))];
  } catch (e) {
    if (e instanceof ValidationError) return [mascotSays(`${e.message} ลองใหม่อีกครั้งนะ`, 'thinking')];
    throw e;
  }
}

export async function afterMultiSaved(ctx: HandlerContext, saved: Transaction[]): Promise<Message[]> {
  const holder = await ctx.deps.repos.pending.create(ctx.userId, MULTI_SAVED_KIND, { ids: saved.map((t) => t.id) }, 24 * 60);
  const dash = await ctx.deps.finance.dashboard(ctx.userId, ctx.today);
  const messages: Message[] = [
    multiSavedMessage(holder.id, saved, ctx.today, multiTotals(saved), await ctx.deps.personality.comment('saved_expense', holder.id), dash.available.availableSatang),
  ];
  for (const categoryId of new Set(saved.filter((t) => t.type === 'expense').map((t) => t.categoryId))) {
    for (const alert of await ctx.deps.finance.budgetAlertsFor(ctx.userId, ctx.today, categoryId)) {
      messages.push(budgetWarningMessage(alert.status, alert.threshold, await ctx.deps.personality.comment(alert.threshold >= 100 ? 'budget_exceeded' : 'budget_warning', `${alert.status.budget.id}:${alert.threshold}`)));
    }
  }
  return messages.slice(0, 5);
}

/** Send a real push (not a reply) so the user can verify notifications end to end. */
export async function sendTestPush(ctx: HandlerContext): Promise<Message[]> {
  const summary = await showDaySummary(ctx, ctx.today);
  try {
    await ctx.deps.line.push(ctx.userId, [mascotSays('นี่คือแจ้งเตือนทดสอบจากชิกชิก 🔔 ถ้าเห็นข้อความนี้ แปลว่าสรุปรายวันและเตือนบิลจะส่งถึงคุณได้แน่นอน', 'smart'), ...summary]);
    return [mascotSays('ส่งแจ้งเตือนทดสอบแล้ว ✓ สรุปรายวันจะมาตอน 21:00 และเตือนบิลตอน 08:00 นะ', 'happy')];
  } catch (err) {
    const status = (err as { status?: number }).status;
    ctx.deps.log.error('test_push_failed', { status: status ?? null, error: err instanceof Error ? err.message : String(err) });
    const why = status === 429 ? 'โควตาข้อความ push ของ LINE OA เดือนนี้หมดแล้ว (ดูได้ใน LINE OA Manager)' : status === 403 || status === 400 ? 'LINE ไม่ยอมให้ส่ง push ถึงบัญชีนี้ (ลองบล็อกแล้วเพิ่มเพื่อนใหม่)' : 'ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ';
    return [mascotSays(`ส่งแจ้งเตือนทดสอบไม่ได้: ${why}`, 'worried')];
  }
}

export async function showCategorySpend(ctx: HandlerContext, categoryId: string): Promise<Message[]> {
  const v = await ctx.deps.finance.monthSummary(ctx.userId, ctx.today);
  const cat = getCategory(categoryId);
  const row = [...v.totals.expenseByCategory, ...v.totals.incomeByCategory].find((c) => c.categoryId === categoryId);
  const budget = v.budgets.find((b) => b.budget.categoryId === categoryId);
  const text = row
    ? `รอบนี้ ${cat.emoji} ${cat.labelTh} ${cat.kind === 'income' ? 'ได้รับ' : 'ใช้ไป'} ${formatBaht(row.amountSatang)} (${row.count} รายการ)${budget ? `\nงบ ${formatBaht(budget.budget.limitSatang)} · ใช้ไป ${Math.floor(budget.usedBasisPoints / 100)}%` : ''}`
    : `รอบนี้ยังไม่มีรายการหมวด ${cat.emoji} ${cat.labelTh} เลย`;
  return [mascotSays(text, budget?.level === 'exceeded' ? 'angry' : budget?.level === 'warning' ? 'worried' : 'smart', [pb('รายงานเดือนนี้', 'report_monthly', {}), pb('ภาพรวม', 'dashboard')])];
}

export async function showTodayList(ctx: HandlerContext): Promise<Message[]> {
  const items = await ctx.deps.repos.transactions.listByRange(ctx.userId, ctx.today, ctx.today);
  return [historyMessage([...items].reverse(), 0, false, ctx.today)];
}
