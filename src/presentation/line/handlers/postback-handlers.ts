/**
 * One handler per postback action. The mapped type forces this object to cover EVERY action in the
 * catalogue — adding a button without a handler is a compile error (and a test failure).
 */
import { addDays } from '../../../domain/dates.ts';
import { formatBaht } from '../../../domain/money.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import type { FixedCostProposal, GoalProposal } from '../../../application/parser/setup-parsers.ts';
import { ValidationError } from '../../../application/services/transaction-service.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import { text } from '../../../infrastructure/line/messages.ts';
import type { HandlerContext } from '../context.ts';
import type { ActionName, ActionParams } from '../postback.ts';
import { pb } from '../flex/actions.ts';
import { budgetCategoryPickerMessage, goalAddPrompt } from '../flex/budgets-goals.ts';
import { helpMessage, mascotSays, onboardingCycleMessage, onboardingIncomeMessage, staleActionMessage } from '../flex/common.ts';
import {
  confirmDeleteFixedCostMessage,
  fixedCostAddPrompt,
  fixedCostDetailMessage,
  payConfirmMessage,
} from '../flex/fixed-costs.ts';
import { cycleSettingMessage, deleteDataConfirmMessage, settingsMessage } from '../flex/settings.ts';
import { askAmountMessage, autoRecordMessage, categoryPickerMessage, confirmDeleteMessage, confirmTransactionMessage, deletedMessage, startEntryMessage } from '../flex/transactions.ts';
import {
  afterMultiSaved,
  afterTransactionSaved,
  MULTI_SAVED_KIND,
  categoryLabel,
  showBudgets,
  showDashboard,
  showDaySummary,
  showFixedCosts,
  showGoals,
  showHistory,
  showMonthSummary,
  showReportsMenu,
  showUpcomingBills,
  showWeekSummary,
} from './views.ts';
import { exportUserData } from './privacy.ts';
import { scanPrompt, showInvite, showPlans, showWealthPlan } from './views.ts';
import { savedToGoalText } from '../flex/wealth.ts';
import type { SaveResult } from '../../../application/services/wealth-service.ts';
import { PLANS, PRICES } from '../../../domain/plans.ts';
import { checkoutMessage, paidMessage } from '../flex/plans.ts';
import { confirmEdit, pickEditTarget } from './edit-handler.ts';
import { createImportService } from '../../../application/services/import-service.ts';

export const FIXED_COST_DRAFT_KIND = 'fixed_cost';
export const GOAL_DRAFT_KIND = 'goal';

type Handlers = { [A in ActionName]: (ctx: HandlerContext, params: ActionParams<A>) => Promise<Message[]> };

const say = (msg: string, mascot: Parameters<typeof mascotSays>[1] = 'happy') => [mascotSays(msg, mascot)];

export const postbackHandlers: Handlers = {
  // ── Rich Menu ──
  dashboard: (ctx) => showDashboard(ctx),
  add_expense: async (ctx) => {
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_entry', { type: 'expense' });
    return [startEntryMessage('expense')];
  },
  add_income: async (ctx) => {
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_entry', { type: 'income' });
    return [startEntryMessage('income')];
  },
  fixed_costs: (ctx) => showFixedCosts(ctx),
  budgets: (ctx) => showBudgets(ctx),
  reports: (ctx) => showReportsMenu(ctx),

  // ── transactions ──
  txn_confirm: async (ctx, { id }) => {
    const r = await ctx.deps.txns.confirm(ctx.userId, id, ctx.today);
    switch (r.status) {
      case 'saved':
        await ctx.deps.repos.conversation.clear(ctx.userId);
        return afterTransactionSaved(ctx, r.transaction);
      case 'already_confirmed':
        return say('รายการนี้บันทึกไปแล้วน้า ไม่จดซ้ำให้ 😉', 'smart');
      case 'duplicate':
        return say('สลิป/รายการนี้จดไปแล้ว ชิกชิกไม่บันทึกซ้ำให้นะ 😉', 'smart');
      case 'cancelled':
        return say('รายการนี้ยกเลิกไปแล้ว พิมพ์ใหม่ได้เลย', 'thinking');
      case 'invalid':
        return say(`${r.error.message} ลองพิมพ์ใหม่นะ`, 'thinking');
      default:
        return [staleActionMessage()];
    }
  },
  txn_cancel: async (ctx, { id }) => {
    await ctx.deps.txns.cancel(ctx.userId, id);
    await ctx.deps.repos.conversation.clear(ctx.userId);
    return say(await ctx.deps.personality.comment('cancelled', id), 'happy');
  },
  txn_pick_category: async (ctx, { id, c }) => {
    try {
      const d = await ctx.deps.txns.updateDraft(ctx.userId, id, { categoryId: c }, ctx.today);
      if (!d) return [staleActionMessage()];
      // learn: next time this description gets this category automatically
      if (d.payload.note) await ctx.deps.repos.categoryRules.learn(ctx.userId, d.payload.note, c);
      return [confirmTransactionMessage(d.id, d.payload, ctx.today)];
    } catch (e) {
      if (e instanceof ValidationError) return say(e.message, 'thinking');
      throw e;
    }
  },
  txn_change_category: async (ctx, { id }) => {
    const d = await ctx.deps.txns.getDraft(ctx.userId, id);
    if (!d || d.status !== 'pending' || d.payload.type === 'saving') return [staleActionMessage()];
    return [categoryPickerMessage(id, d.payload.type)];
  },
  txn_pick_date: async (ctx, { id, d }) => {
    if (!d) return [staleActionMessage()];
    return postbackHandlers.txn_set_date(ctx, { id, d });
  },
  txn_set_date: async (ctx, { id, d }) => {
    try {
      const updated = await ctx.deps.txns.updateDraft(ctx.userId, id, { txnDate: d }, ctx.today);
      if (!updated) return [staleActionMessage()];
      return [confirmTransactionMessage(updated.id, updated.payload, ctx.today)];
    } catch (e) {
      if (e instanceof ValidationError) return say(e.message, 'thinking');
      throw e;
    }
  },
  txn_start_category: async (ctx, { t, c }) => {
    if (getCategory(c).kind !== t) return [staleActionMessage()];
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_amount', { type: t, categoryId: c });
    return [askAmountMessage(c)];
  },
  txn_history: (ctx, { p }) => showHistory(ctx, p),
  txn_delete: async (ctx, { id }) => {
    const t = await ctx.deps.txns.get(ctx.userId, id);
    if (!t || t.deletedAt) return [staleActionMessage()];
    return [confirmDeleteMessage(t, ctx.today)];
  },
  txn_delete_confirm: async (ctx, { id }) => {
    const t = await ctx.deps.txns.remove(ctx.userId, id);
    if (!t) return say('รายการนี้ถูกลบไปแล้วน้า', 'thinking');
    return [deletedMessage(t)];
  },
  txn_set_type: async (ctx, { id, t }) => {
    try {
      const d = await ctx.deps.txns.updateDraft(ctx.userId, id, { type: t }, ctx.today);
      if (!d) return [staleActionMessage()];
      return [confirmTransactionMessage(d.id, d.payload, ctx.today), categoryPickerMessage(d.id, t)];
    } catch (e) {
      if (e instanceof ValidationError) return say(e.message, 'thinking');
      throw e;
    }
  },
  import_confirm: async (ctx, { id }) => {
    const r = await createImportService(ctx.deps.sql, ctx.deps.repos).confirm(ctx.userId, id);
    if (r.status === 'stale') return [staleActionMessage()];
    const extra = r.duplicates ? ` (ข้าม ${r.duplicates} รายการที่มีอยู่แล้ว)` : '';
    return [mascotSays(`นำเข้าแล้ว ${r.inserted} รายการ${extra} 🎉`, 'celebrating', [pb('ภาพรวม', 'dashboard'), pb('ดูประวัติ', 'txn_history', { p: 0 })])];
  },
  txn_undo: async (ctx, { id }) => {
    const t = await ctx.deps.txns.restore(ctx.userId, id);
    if (!t) return say('เอากลับมาไม่ได้แล้ว (อาจมีการจ่ายบิลนี้ใหม่ไปแล้ว)', 'worried');
    return say(`เอากลับมาแล้ว ✓ ${categoryLabel(t.categoryId)}`, 'happy');
  },

  // ── fixed costs ──
  fc_add: async (ctx) => {
    await ctx.deps.plans.assertCanAdd(ctx.userId, 'fixed_costs');
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_fixed_cost', {});
    return [fixedCostAddPrompt()];
  },
  fc_detail: async (ctx, { id }) => {
    const d = await ctx.deps.fixedCosts.detail(ctx.userId, id);
    if (!d) return [staleActionMessage()];
    return [fixedCostDetailMessage(d.fixedCost, d.recent, ctx.today)];
  },
  fc_pay: async (ctx, { id }) => {
    const r = await ctx.deps.fixedCosts.getOccurrence(ctx.userId, id);
    if (!r) return [staleActionMessage()];
    if (r.occurrence.status !== 'pending') return say(r.occurrence.status === 'paid' ? 'บิลงวดนี้จ่ายไปแล้วน้า ✅' : 'งวดนี้ข้ามไปแล้วน้า', 'smart');
    return [payConfirmMessage(r.occurrence, r.fixedCost, ctx.today)];
  },
  fc_pay_confirm: async (ctx, { id }) => {
    const r = await ctx.deps.fixedCosts.pay(ctx.userId, id, ctx.today);
    if (r.status === 'not_found') return [staleActionMessage()];
    if (r.status === 'already_resolved') return say('บิลงวดนี้บันทึกไปแล้ว ไม่หักซ้ำแน่นอน 😉', 'smart');
    return afterTransactionSaved(ctx, r.transaction);
  },
  fc_pay_custom: async (ctx, { id }) => {
    const r = await ctx.deps.fixedCosts.getOccurrence(ctx.userId, id);
    if (!r || r.occurrence.status !== 'pending') return [staleActionMessage()];
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_fc_amount', { occurrenceId: id });
    return [text(`จ่าย "${r.fixedCost.name}" ไปเท่าไหร่? พิมพ์จำนวนเงินมาได้เลย`)];
  },
  fc_create_confirm: async (ctx, { id }) => {
    const won = await ctx.deps.repos.pending.resolve<FixedCostProposal>(ctx.userId, id, 'confirmed');
    if (!won || won.kind !== FIXED_COST_DRAFT_KIND) return [staleActionMessage()];
    const p = won.payload;
    await ctx.deps.plans.assertCanAdd(ctx.userId, 'fixed_costs');
    await ctx.deps.fixedCosts.create(ctx.userId, { name: p.name, amountSatang: p.amountSatang, categoryId: p.categoryId, rule: p.rule }, ctx.today);
    await ctx.deps.repos.conversation.clear(ctx.userId);
    return [mascotSays(`เพิ่ม "${p.name}" แล้ว! ชิกชิกจะเตือนก่อนถึงกำหนดนะ 📅`, 'discipline'), ...(await showFixedCosts(ctx))];
  },
  fc_skip: async (ctx, { id }) => {
    const o = await ctx.deps.fixedCosts.skip(ctx.userId, id);
    return o ? say('ข้ามงวดนี้แล้ว ไม่หักออกจากยอดใช้ได้', 'happy') : [staleActionMessage()];
  },
  fc_pause: async (ctx, { id }) =>
    (await ctx.deps.fixedCosts.pause(ctx.userId, id, ctx.today)) ? say('หยุดชั่วคราวแล้ว จะไม่เตือนและไม่หักยอดงวดต่อไป', 'sleepy') : [staleActionMessage()],
  fc_resume: async (ctx, { id }) =>
    (await ctx.deps.fixedCosts.resume(ctx.userId, id, ctx.today)) ? say('เริ่มใหม่แล้ว! ชิกชิกจะเตือนตามรอบเหมือนเดิม', 'encouraging') : [staleActionMessage()],
  fc_delete: async (ctx, { id }) => {
    const fc = await ctx.deps.repos.fixedCosts.get(ctx.userId, id);
    return fc ? [confirmDeleteFixedCostMessage(fc)] : [staleActionMessage()];
  },
  fc_delete_confirm: async (ctx, { id }) =>
    (await ctx.deps.fixedCosts.remove(ctx.userId, id, ctx.today)) ? say('ลบแล้วจ้า', 'happy') : [staleActionMessage()],
  fc_bills: (ctx) => showUpcomingBills(ctx, 14),

  // ── budgets & goals ──
  budget_add: async () => [budgetCategoryPickerMessage()],
  budget_pick_category: async (ctx, { c }) => {
    await ctx.deps.plans.assertCanAdd(ctx.userId, 'category_budget', c);
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_budget_amount', { categoryId: c });
    return [text(`ตั้งงบ ${c === 'total' ? '🧺 รวมทั้งเดือน' : categoryLabel(c)} เดือนละเท่าไหร่? พิมพ์จำนวนเงินมาได้เลย`)];
  },
  budget_delete: async (ctx, { id }) =>
    (await ctx.deps.finance.deleteBudget(ctx.userId, id)) ? [mascotSays('ลบงบนี้แล้ว', 'happy'), ...(await showBudgets(ctx))] : [staleActionMessage()],
  goals: (ctx) => showGoals(ctx),
  goal_add: async (ctx) => {
    await ctx.deps.plans.assertCanAdd(ctx.userId, 'goals');
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_goal', {});
    return [goalAddPrompt()];
  },
  goal_create_confirm: async (ctx, { id }) => {
    const won = await ctx.deps.repos.pending.resolve<GoalProposal>(ctx.userId, id, 'confirmed');
    if (!won || won.kind !== GOAL_DRAFT_KIND) return [staleActionMessage()];
    await ctx.deps.plans.assertCanAdd(ctx.userId, 'goals');
    await ctx.deps.finance.createGoal(ctx.userId, won.payload);
    await ctx.deps.repos.conversation.clear(ctx.userId);
    return [mascotSays(`ตั้งเป้า "${won.payload.name}" แล้ว! สู้ๆ นะ 💪`, 'encouraging'), ...(await showGoals(ctx))];
  },
  goal_contribute: async (ctx, { id }) => {
    const g = await ctx.deps.repos.goals.get(ctx.userId, id);
    if (!g || g.status === 'archived') return [staleActionMessage()];
    await ctx.deps.repos.conversation.set(ctx.userId, 'await_goal_contribution', { goalId: id });
    return [text(`ออมเข้า "${g.name}" เท่าไหร่ดี? พิมพ์จำนวนเงินมาได้เลย 🐷`)];
  },
  goal_archive: async (ctx, { id }) =>
    (await ctx.deps.finance.archiveGoal(ctx.userId, id)) ? [mascotSays('เก็บเป้าหมายนี้เข้ากรุแล้ว', 'happy'), ...(await showGoals(ctx))] : [staleActionMessage()],

  // ── reports ──
  report_daily: (ctx, { d }) => showDaySummary(ctx, d && d <= ctx.today ? d : ctx.today),
  report_weekly: (ctx) => showWeekSummary(ctx),
  report_monthly: (ctx, { k }) => showMonthSummary(ctx, k),
  report_categories: (ctx) => showMonthSummary(ctx),

  // ── onboarding & settings ──
  onboard_start: async () => [onboardingCycleMessage()],
  onboard_cycle: async (ctx, { day }) => {
    await ctx.deps.repos.users.setCycleStartDay(ctx.userId, day);
    const user = await ctx.deps.repos.users.get(ctx.userId);
    if (user && user.onboarding !== 'done') {
      await ctx.deps.repos.users.setOnboarding(ctx.userId, 'asked_income');
      return [onboardingIncomeMessage()];
    }
    return say(`ตั้งรอบเดือนเริ่มวันที่ ${day} แล้ว ✓`, 'happy');
  },
  onboard_skip_income: async (ctx) => {
    await ctx.deps.repos.users.setOnboarding(ctx.userId, 'done');
    return [mascotSays('ได้เลย! เริ่มจดรายจ่ายได้ทันที เช่น "กินข้าว 65" 🐔', 'encouraging', [pb('วิธีใช้', 'help'), pb('ภาพรวม', 'dashboard')])];
  },
  settings: async (ctx) => {
    const u = await ctx.deps.repos.users.get(ctx.userId);
    return u ? [settingsMessage(u)] : [staleActionMessage()];
  },
  settings_toggle: async (ctx, { k }) => {
    await ctx.deps.repos.users.toggleNotification(ctx.userId, k);
    const u = await ctx.deps.repos.users.get(ctx.userId);
    return [settingsMessage(u!)];
  },
  settings_cycle: async (ctx) => {
    const u = await ctx.deps.repos.users.get(ctx.userId);
    return [cycleSettingMessage(u?.cycleStartDay ?? 1)];
  },
  data_export: (ctx) => exportUserData(ctx),
  data_delete: async () => [deleteDataConfirmMessage()],
  data_delete_confirm: async (ctx) => {
    await ctx.deps.repos.users.deleteCompletely(ctx.userId);
    return [text('ลบข้อมูลทั้งหมดเรียบร้อยแล้ว 🧹\nถ้าอยากเริ่มใหม่ แค่พิมพ์อะไรก็ได้มาหาชิกชิกนะ')];
  },
  help: async () => [helpMessage()],

  // ── plans ──
  plans: (ctx) => showPlans(ctx),
  pay_start: async (ctx, { p }) => {
    const payments = ctx.deps.payments;
    if (!payments?.availableFor(ctx.userId)) return showPlans(ctx);
    try {
      const { payment, url } = await payments.checkout(ctx.userId, p);
      return [checkoutMessage(payment.id, p, url)];
    } catch (e) {
      ctx.deps.log.error('checkout_failed', { error: e instanceof Error ? e.message : String(e) });
      return [mascotSays('ตอนนี้เปิดหน้าชำระเงินไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่นะ 🙏', 'worried', [pb('แพ็กเกจของฉัน', 'plans')])];
    }
  },
  pay_check: async (ctx, { id }) => {
    const payments = ctx.deps.payments;
    if (!payments) return [staleActionMessage()];
    const r = await payments.check(ctx.userId, id).catch(() => null);
    if (!r || r.status === 'not_found') return [staleActionMessage()];
    if (r.status === 'paid') await ctx.deps.richMenus.sync(ctx.userId);
    if (r.status === 'paid') return [paidMessage(r.payment.plan, r.until ?? (await ctx.deps.plans.status(ctx.userId)).until)];
    return [mascotSays('ยังไม่เห็นการชำระเงินน้า ถ้าเพิ่งสแกนจ่าย รอสักครู่แล้วกดตรวจสอบอีกครั้ง (จ่ายเสร็จชิกชิกจะแจ้งเองด้วย)', 'thinking', [pb('ตรวจสอบอีกครั้ง', 'pay_check', { id }), pb('แพ็กเกจของฉัน', 'plans')])];
  },
  // ── savings-first ──
  wealth_plan: (ctx) => showWealthPlan(ctx),
  scan: async () => scanPrompt(),
  invite: (ctx) => showInvite(ctx),
  wealth_emergency: async (ctx) => {
    const { goal, created } = await ctx.deps.wealth.ensureEmergencyGoal(ctx.userId, ctx.today);
    return [mascotSays(created ? `สร้างเป้า "${goal.name}" เป้าหมาย ${formatBaht(goal.targetSatang)} (3 เท่าของค่าใช้จ่ายต่อเดือน) แล้ว! เริ่มเก็บทีละนิดก็ได้ 💪` : `มีเป้า "${goal.name}" อยู่แล้วน้า`, 'encouraging', [pb('🐷 เก็บเลย', 'goal_contribute', { id: goal.id }), pb('แผนการเงิน', 'wealth_plan')])];
  },
  save_first: async (ctx, { id, p }) => savedReply(ctx, await ctx.deps.wealth.saveFirst(ctx.userId, id, Number(p), ctx.today)),
  sweep: async (ctx, { k, f }) => savedReply(ctx, await ctx.deps.wealth.sweep(ctx.userId, k, f, ctx.today)),
  plan_interest: async (ctx, { p }) => {
    const fresh = await ctx.deps.repos.plans.addInterest(ctx.userId, p);
    const early = p === 'plus' ? ` พร้อมราคาผู้ใช้กลุ่มแรก ฿${PRICES.plus.earlyBirdYearly}/ปี (ล็อกราคาตลอด)` : '';
    return [mascotSays(fresh ? `จดชื่อไว้แล้ว! ตอนนี้ ${PLANS[p].label} ยังไม่เปิดรับชำระเงิน ชิกชิกจะทักไปบอกทันทีที่เปิด${early} 🐔` : `ชิกชิกจดไว้แล้วน้า จะบอกทันทีที่ ${PLANS[p].label} เปิดให้สมัคร`, 'celebrating', [pb('แพ็กเกจของฉัน', 'plans'), pb('ภาพรวม', 'dashboard')])];
  },
  cancel_flow: async (ctx) => {
    await ctx.deps.repos.conversation.clear(ctx.userId);
    return say('โอเค ไม่เป็นไรจ้า', 'happy');
  },
  multi_confirm: async (ctx, { id }) => {
    const r = await ctx.deps.txns.confirmMulti(ctx.userId, id, ctx.today);
    if (r.status === 'stale') return say('รายการชุดนี้บันทึกหรือยกเลิกไปแล้วน้า', 'smart');
    if (r.status === 'invalid') return say(`${r.error.message} ลองพิมพ์ใหม่นะ`, 'thinking');
    return afterMultiSaved(ctx, r.transactions);
  },
  multi_undo: async (ctx, { id }) => {
    const holder = await ctx.deps.repos.pending.resolve<{ ids: string[] }>(ctx.userId, id, 'cancelled');
    if (!holder || holder.kind !== MULTI_SAVED_KIND) return say('ยกเลิกชุดนี้ไม่ได้แล้ว (อาจยกเลิกไปแล้ว หรือนานเกิน 1 วัน) ลบทีละรายการได้ในประวัติ', 'thinking');
    const n = await ctx.deps.txns.removeMany(ctx.userId, holder.payload.ids);
    return say(`ยกเลิก ${n} รายการแล้ว`, 'happy');
  },
  auto_record_toggle: async (ctx, { on }) => {
    await ctx.deps.repos.users.setAutoRecord(ctx.userId, on === '1');
    return [autoRecordMessage(on === '1')];
  },
  edit_pick: async (ctx, { id, i }) => (await pickEditTarget(ctx, id, i)) ?? [staleActionMessage()],
  edit_confirm: async (ctx, { id }) => (await confirmEdit(ctx, id)) ?? [staleActionMessage()],
  fc_pay_amount: async (ctx, { id, amt }) => {
    const r = await ctx.deps.fixedCosts.pay(ctx.userId, id, ctx.today, amt);
    if (r.status === 'not_found') return [staleActionMessage()];
    if (r.status === 'already_resolved') return say('บิลงวดนี้บันทึกไปแล้ว ไม่หักซ้ำแน่นอน 😉', 'smart');
    await ctx.deps.repos.pending.cancelAllPending(ctx.userId, 'transaction');
    return afterTransactionSaved(ctx, r.transaction);
  },
  draft_cancel: async (ctx, { id }) => {
    await ctx.deps.repos.pending.resolve(ctx.userId, id, 'cancelled');
    await ctx.deps.repos.conversation.clear(ctx.userId);
    return say(await ctx.deps.personality.comment('cancelled', id), 'happy');
  },
};

/** Exposed for tests: dates the user may pick for a transaction. */
export const dateBounds = (today: string) => ({ min: addDays(today, -366), max: addDays(today, 31) });

/** Reply after "เก็บก่อนใช้" / month-end sweep. */
async function savedReply(ctx: HandlerContext, r: SaveResult): Promise<Message[]> {
  if (r.status === 'duplicate') return [mascotSays('ก้อนนี้เก็บไปแล้วน้า ไม่เก็บซ้ำให้ 😉', 'smart', [pb('แผนการเงิน', 'wealth_plan')])];
  if (r.status !== 'saved') return [staleActionMessage()];
  const progress = await ctx.deps.finance.goalProgress(ctx.userId, r.goal.id);
  const pctText = progress ? ` (ถึงเป้าแล้ว ${Math.round(progress.progressBasisPoints / 100)}%)` : '';
  return [
    mascotSays(`${savedToGoalText(r.goal, r.txn.amountSatang, r.createdGoal)}${pctText}`, 'proud', [
      pb('ยกเลิกรายการนี้', 'txn_delete', { id: r.txn.id }),
      pb('แผนการเงิน', 'wealth_plan'),
      pb('ภาพรวม', 'dashboard'),
    ]),
  ];
}
