/**
 * Free-text messages: multi-step flow states first, then the Thai intent parser.
 * Parse → validate → confirmation card. Nothing is saved from text alone.
 */
import { type ParseResult, type TransactionProposal } from '../../../application/parser/intent-parser.ts';
import { parseMessage, type MessageParse } from '../../../application/parser/message-parser.ts';
import type { TransactionDraft } from '../../../application/services/transaction-service.ts';
import { addDays } from '../../../domain/dates.ts';
import { periodForDate, previousPeriod } from '../../../domain/period.ts';
import { getCategory, isKnownCategory } from '../../../domain/entities/categories.ts';
import { autoRecordMessage, deletedMessage } from '../flex/transactions.ts';
import { handleEdit } from './edit-handler.ts';
import { aiEditToIntent, aiIntentToParseResult, isSafeChatLine } from '../../../application/personality/ai-assist.ts';
import { parseBareAmount, parseFixedCost, parseGoal } from '../../../application/parser/setup-parsers.ts';
import { ValidationError } from '../../../application/services/transaction-service.ts';
import { defaultCategoryFor } from '../../../domain/entities/categories.ts';
import { formatBaht } from '../../../domain/money.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { claimReply } from '../flex/engagement.ts';
import type { FlowState, HandlerContext } from '../context.ts';
import { pb } from '../flex/actions.ts';
import { confirmGoalMessage } from '../flex/budgets-goals.ts';
import { helpMessage, mascotSays } from '../flex/common.ts';
import { confirmFixedCostMessage } from '../flex/fixed-costs.ts';
import { cycleSettingMessage, deleteDataConfirmMessage, settingsMessage } from '../flex/settings.ts';
import { FIXED_COST_DRAFT_KIND, GOAL_DRAFT_KIND, postbackHandlers } from './postback-handlers.ts';
import {
  afterTransactionSaved,
  proposeTransaction,
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
  proposeMulti,
  sendTestPush,
  showPlans,
  showWealthPlan,
  scanPrompt,
  showInvite,
  showCategorySpend,
  showTodayList,
} from './views.ts';

const SETUP_DRAFT_TTL = 30;

const FIXED_COST_ERRORS: Record<string, string> = {
  no_schedule: 'ยังไม่รู้ว่าจ่ายบ่อยแค่ไหน ลองเติม "ทุกวันที่ 5" หรือ "ทุกเดือน" ต่อท้ายนะ',
  no_amount: 'ยังไม่เห็นจำนวนเงินเลย เช่น "ค่าเน็ต 599 ทุกวันที่ 5"',
  multiple_amounts: 'เจอตัวเลขหลายตัว งงเลย ลองพิมพ์ใหม่แบบ "ค่าเน็ต 599 ทุกวันที่ 5"',
  no_name: 'ขอชื่อรายการด้วยน้า เช่น "ค่าห้อง 6500 ทุกวันที่ 1"',
  invalid: 'ข้อมูลยังไม่ถูกต้อง ลองใหม่อีกครั้งนะ',
};

async function handleFlow(ctx: HandlerContext, flow: FlowState, input: string): Promise<Message[] | null> {
  const { deps, userId } = ctx;
  switch (flow.state) {
    case 'await_amount': {
      const amount = parseBareAmount(input);
      if (amount === null) return null; // fall through to normal parsing (e.g. they typed "กินข้าว 65")
      await deps.repos.conversation.clear(userId);
      return proposeTransaction(ctx, {
        type: flow.context.type,
        amountSatang: amount,
        categoryId: flow.context.categoryId,
        categoryConfident: true,
        note: null,
        txnDate: ctx.today,
        source: 'rich_menu',
      });
    }
    case 'await_entry': {
      const amount = parseBareAmount(input);
      if (amount === null) {
        await deps.repos.conversation.clear(userId);
        return null;
      }
      // just a number after tapping "add income/expense": keep the chosen type, ask for category
      await deps.repos.conversation.clear(userId);
      return proposeTransaction(ctx, {
        type: flow.context.type,
        amountSatang: amount,
        categoryId: defaultCategoryFor(flow.context.type),
        categoryConfident: false,
        note: null,
        txnDate: ctx.today,
        source: 'rich_menu',
      });
    }
    case 'await_fixed_cost': {
      const r = parseFixedCost(input, ctx.today);
      if (!r.ok) return [mascotSays(FIXED_COST_ERRORS[r.error] ?? FIXED_COST_ERRORS.invalid!, 'thinking', [pb('ยกเลิก', 'cancel_flow')])];
      const draft = await deps.repos.pending.create(userId, FIXED_COST_DRAFT_KIND, r.value, SETUP_DRAFT_TTL);
      return [confirmFixedCostMessage(draft.id, r.value)];
    }
    case 'await_goal': {
      const r = parseGoal(input);
      if (!r.ok) return [mascotSays('ลองพิมพ์แบบ "เที่ยวญี่ปุ่น 30000 เดือนละ 3000" นะ', 'thinking', [pb('ยกเลิก', 'cancel_flow')])];
      const draft = await deps.repos.pending.create(userId, GOAL_DRAFT_KIND, r.value, SETUP_DRAFT_TTL);
      return [confirmGoalMessage(draft.id, r.value)];
    }
    case 'await_budget_amount': {
      const amount = parseBareAmount(input);
      if (amount === null) return [mascotSays('พิมพ์แค่จำนวนเงินนะ เช่น 6000', 'thinking', [pb('ยกเลิก', 'cancel_flow')])];
      try {
        await deps.plans.assertCanAdd(userId, 'category_budget', flow.context.categoryId);
        await deps.finance.setBudget(userId, flow.context.categoryId, amount);
      } catch (e) {
        if (e instanceof ValidationError) return [mascotSays(e.message, 'thinking')];
        throw e;
      }
      await deps.repos.conversation.clear(userId);
      return [mascotSays(`ตั้งงบ ${formatBaht(amount)} ต่อเดือนแล้ว ✓`, 'discipline'), ...(await showBudgets(ctx))];
    }
    case 'await_goal_contribution': {
      const amount = parseBareAmount(input);
      if (amount === null) return [mascotSays('พิมพ์แค่จำนวนเงินนะ เช่น 500', 'thinking', [pb('ยกเลิก', 'cancel_flow')])];
      await deps.repos.conversation.clear(userId);
      return proposeTransaction(ctx, {
        type: 'saving',
        amountSatang: amount,
        categoryId: 'savings',
        categoryConfident: true,
        note: null,
        txnDate: ctx.today,
        source: 'savings',
        savingsGoalId: flow.context.goalId,
      });
    }
    case 'await_fc_amount': {
      const amount = parseBareAmount(input);
      if (amount === null) return [mascotSays('พิมพ์แค่จำนวนเงินที่จ่ายจริงนะ เช่น 1732.50', 'thinking', [pb('ยกเลิก', 'cancel_flow')])];
      await deps.repos.conversation.clear(userId);
      const r = await deps.fixedCosts.pay(userId, flow.context.occurrenceId, ctx.today, amount);
      if (r.status === 'paid') return afterTransactionSaved(ctx, r.transaction);
      return [mascotSays(r.status === 'already_resolved' ? 'บิลงวดนี้บันทึกไปแล้วน้า ไม่หักซ้ำ' : 'ไม่เจอบิลนี้แล้ว', 'smart')];
    }
  }
}

async function handleParsed(ctx: HandlerContext, parsed: ParseResult): Promise<Message[]> {
  const { deps, userId } = ctx;
  switch (parsed.kind) {
    case 'transaction':
      return proposeTransaction(ctx, {
        type: parsed.type,
        amountSatang: parsed.amountSatang,
        categoryId: parsed.categoryId,
        categoryConfident: parsed.categoryConfident,
        note: parsed.note,
        txnDate: parsed.txnDate,
        source: 'chat',
      });
    case 'amount_only':
      return [
        text(
          `${formatBaht(parsed.amountSatang)} นี่คือรายจ่ายหรือรายรับ?`,
          quickReply([
            pb('รายจ่าย', 'add_expense', {}, { displayText: 'รายจ่าย' }),
            pb('รายรับ', 'add_income', {}, { displayText: 'รายรับ' }),
          ]),
        ),
        mascotSays(`บอกชื่อรายการด้วยก็ได้นะ เช่น "ข้าว ${formatBaht(parsed.amountSatang).slice(1)}"`, 'thinking'),
      ];
    case 'ambiguous':
      if (parsed.reason === 'multiple_amounts') {
        return [mascotSays('จดหลายรายการได้นะ แต่ทุกจำนวนต้องมีชื่อกำกับ เช่น "ข้าว 50 กาแฟ 40" หรือขึ้นบรรทัดใหม่ทีละรายการ', 'thinking')];
      }
      if (parsed.reason === 'saving_needs_goal') {
        const goals = await deps.finance.goals(userId);
        if (goals.length === 0) return [mascotSays('ยังไม่มีเป้าหมายออมเลย ตั้งก่อนไหม?', 'saving', [pb('➕ ตั้งเป้าหมาย', 'goal_add')])];
        return [text('ออมเข้าเป้าหมายไหนดี?', quickReply(goals.slice(0, 12).map((g) => pb(`🎯 ${g.goal.name}`, 'goal_contribute', { id: g.goal.id }))))];
      }
      return [mascotSays('จำนวนเงินดูแปลกๆ นะ ต้องมากกว่า 0 และไม่เกินพันล้าน', 'shocked')];
    case 'query':
      switch (parsed.intent) {
        case 'today_spent':
          return showDaySummary(ctx);
        case 'available':
        case 'dashboard':
          return showDashboard(ctx);
        case 'upcoming_bills':
          return showUpcomingBills(ctx, parsed.withinDays ?? 7, parsed.date ?? ctx.today);
        case 'month_summary':
          return showMonthSummary(ctx);
        case 'week_summary':
          return showWeekSummary(ctx);
        case 'budgets':
          return showBudgets(ctx);
        case 'fixed_costs':
          return showFixedCosts(ctx);
        case 'goals':
          return showGoals(ctx);
        case 'history':
          return showHistory(ctx, 0);
        case 'reports':
          return showReportsMenu(ctx);
        case 'settings': {
          const u = await deps.repos.users.get(userId);
          return u ? [settingsMessage(u)] : [cycleSettingMessage(1)];
        }
        case 'help':
          return [helpMessage()];
        case 'cancel':
          await deps.repos.pending.cancelAllPending(userId);
          await deps.repos.conversation.clear(userId);
          return [mascotSays(await deps.personality.comment('cancelled', ctx.today), 'happy')];
        case 'greeting':
          return [mascotSays(await deps.personality.comment('greeting', ctx.today), 'happy', [pb('ภาพรวม', 'dashboard'), pb('วิธีใช้', 'help')])];
        case 'thanks':
          return [mascotSays(await deps.personality.comment('thanks', ctx.today), 'encouraging')];
        case 'add_expense':
          return postbackHandlers.add_expense(ctx, {});
        case 'add_income':
          return postbackHandlers.add_income(ctx, {});
        case 'export':
          return postbackHandlers.data_export(ctx, {});
        case 'delete_data':
          return [deleteDataConfirmMessage()];
      }
      break;
    case 'unknown':
      return [mascotSays(await deps.personality.comment('unknown', ctx.today), 'thinking', [pb('วิธีใช้', 'help'), pb('จดรายจ่าย', 'add_expense'), pb('ภาพรวม', 'dashboard')])];
  }
  return [helpMessage()];
}

const toDraft = (p: TransactionProposal): TransactionDraft => ({
  type: p.type,
  amountSatang: p.amountSatang,
  categoryId: p.categoryId,
  categoryConfident: p.categoryConfident,
  note: p.note,
  txnDate: p.txnDate,
  source: 'chat',
});

/** Commands, multi-item entries and extra questions (everything parseMessage adds on top of parseIntent). */
async function handleMessageLevel(ctx: HandlerContext, m: MessageParse): Promise<Message[] | null> {
  const { deps, userId, today } = ctx;
  switch (m.kind) {
    case 'edit':
      return handleEdit(ctx, m);
    case 'multi':
      return proposeMulti(ctx, m.items.map(toDraft));
    case 'command':
      switch (m.command) {
        case 'delete_last': {
          const last = await deps.txns.last(userId);
          if (!last) return [mascotSays('ยังไม่มีรายการให้ลบเลยน้า', 'thinking')];
          const removed = await deps.txns.remove(userId, last.id);
          return removed ? [deletedMessage(removed)] : [mascotSays('ลบไม่สำเร็จ ลองใหม่อีกครั้งนะ', 'worried')];
        }
        case 'edit_last': {
          const last = await deps.txns.last(userId);
          if (!last) return [mascotSays('ยังไม่มีรายการให้แก้เลยน้า', 'thinking')];
          try {
            const t = await deps.txns.editAmount(userId, last.id, m.amountSatang, today);
            if (!t) return [mascotSays('แก้ไม่สำเร็จ ลองใหม่อีกครั้งนะ', 'worried')];
            return [mascotSays(`แก้ "${t.note ?? getCategory(t.categoryId).labelTh}" เป็น ${formatBaht(t.amountSatang)} แล้ว ✓`, 'happy', [pb('ดูประวัติ', 'txn_history', { p: 0 }), pb('ภาพรวม', 'dashboard')])];
          } catch (e) {
            if (e instanceof ValidationError) return [mascotSays(e.message, 'thinking')];
            throw e;
          }
        }
        case 'set_budget':
          await deps.plans.assertCanAdd(userId, 'category_budget', m.categoryId);
          await deps.finance.setBudget(userId, m.categoryId, m.amountSatang);
          return [mascotSays(`ตั้งงบ ${m.categoryId === 'total' ? 'รวมทั้งเดือน' : getCategory(m.categoryId).labelTh} ${formatBaht(m.amountSatang)} ต่อเดือนแล้ว ✓`, 'discipline'), ...(await showBudgets(ctx))];
        case 'auto_record':
          await deps.repos.users.setAutoRecord(userId, m.on);
          return [autoRecordMessage(m.on)];
        case 'test_push':
          return sendTestPush(ctx);
        case 'plans':
          return showPlans(ctx);
        case 'wealth_plan':
          return showWealthPlan(ctx);
        case 'scan':
          return scanPrompt();
        case 'invite':
          return showInvite(ctx);
        case 'claim_code': {
          const r = await deps.engagement.claim(userId, m.code);
          return [claimReply(r.status, r.status === 'ok' ? r.referrerName : null)];
        }
        case 'my_id':
          return [text(`LINE user ID ของคุณ (ใช้ตั้งค่าผู้ทดสอบ/ติดต่อทีมงาน):
${userId}`)];
      }
      break;
    case 'extra_query':
      switch (m.query) {
        case 'yesterday_spent':
          return showDaySummary(ctx, addDays(today, -1));
        case 'last_month_summary': {
          const user = await deps.repos.users.get(userId);
          return showMonthSummary(ctx, previousPeriod(periodForDate(today, user?.cycleStartDay ?? 1)).key);
        }
        case 'today_list':
          return showTodayList(ctx);
        case 'category_spend':
          return showCategorySpend(ctx, m.categoryId);
      }
  }
  return null;
}

/** The user's own item names, so the AI can tell which bill/goal/budget they are talking about. */
async function knownItems(ctx: HandlerContext): Promise<string> {
  const [costs, goals, budgets] = await Promise.all([
    ctx.deps.repos.fixedCosts.list(ctx.userId),
    ctx.deps.repos.goals.listActive(ctx.userId),
    ctx.deps.repos.budgets.list(ctx.userId),
  ]);
  return [
    ...costs.map((c) => `bill: ${c.name}`),
    ...goals.map((g) => `goal: ${g.name}`),
    ...budgets.map((b) => `budget: ${b.categoryId === 'total' ? 'งบรวม' : getCategory(b.categoryId).labelTh}`),
  ].join('; ');
}

export async function handleText(ctx: HandlerContext, input: string): Promise<Message[]> {
  const trimmed = input.trim();
  const message = parseMessage(trimmed, ctx.today);
  const parsed: ParseResult = message.kind === 'multi' || message.kind === 'command' || message.kind === 'extra_query' || message.kind === 'edit' ? { kind: 'unknown' } : message;
  if (message !== parsed) {
    // flows that expect a bare amount must not swallow a command or multi-item message
    await ctx.deps.repos.conversation.clear(ctx.userId);
    const handled = await handleMessageLevel(ctx, message);
    if (handled) return handled;
  }

  // "ยกเลิก" always escapes any flow
  if (parsed.kind === 'query' && parsed.intent === 'cancel') return handleParsed(ctx, parsed);

  const flow = (await ctx.deps.repos.conversation.get(ctx.userId)) as FlowState | null;
  if (flow) {
    const handled = await handleFlow(ctx, flow, trimmed);
    if (handled) return handled;
    await ctx.deps.repos.conversation.clear(ctx.userId);
  }

  // Rules produced an UNSURE expense from chat: ask the AI once, with the user's item names. It may
  // recognise an edit ("ห้องขึ้นราคา…3500") or a better category. Same guards as everywhere.
  if (parsed.kind === 'transaction' && !parsed.categoryConfident && ctx.deps.ai && trimmed.length <= 500 && (await ctx.deps.plans.useAi(ctx.userId, ctx.today))) {
    const intent = await ctx.deps.ai.interpret(trimmed, await knownItems(ctx)).catch(() => null);
    if (intent) {
      const edit = aiEditToIntent(intent, trimmed);
      if (edit) return handleEdit(ctx, edit);
      const c = intent.category_id;
      if (intent.kind === 'transaction' && c && isKnownCategory(c) && getCategory(c).kind === parsed.type) {
        return handleParsed(ctx, { ...parsed, categoryId: c, categoryConfident: true });
      }
    }
  }

  // Optional AI fallback: only for text the rules couldn't read. Its output becomes the same kind of
  // proposal the rules produce (amount must literally appear in the text) and still needs confirmation.
  if (parsed.kind === 'unknown' && ctx.deps.ai && trimmed.length <= 500 && (await ctx.deps.plans.useAi(ctx.userId, ctx.today))) {
    const intent = await ctx.deps.ai.interpret(trimmed, await knownItems(ctx));
    if (intent) {
      const edit = aiEditToIntent(intent, trimmed);
      if (edit) return handleEdit(ctx, edit);
      if (intent.kind === 'chitchat' && isSafeChatLine(intent.reply)) {
        return [mascotSays(intent.reply, 'happy', [pb('ภาพรวม', 'dashboard'), pb('วิธีใช้', 'help')])];
      }
      const fromAi = aiIntentToParseResult(intent, trimmed, ctx.today);
      if (fromAi.kind !== 'unknown') return handleParsed(ctx, fromAi);
    }
  }
  return handleParsed(ctx, parsed);
}
