/**
 * Editing things by name, in loose language, with questions when unsure.
 *   resolve target (fuzzy) → unique: confirm card │ several/none: "หมายถึงอันไหน?" quick replies
 *   confirm → execute through the normal services (same validation as everywhere else)
 * Also: an expense whose description matches one of the user's bills offers "pay this bill?".
 */
import type { EditIntent } from '../../../application/parser/edit-parser.ts';
import { resolve, type EntityCandidate, type ScoredCandidate } from '../../../application/services/entity-resolver.ts';
import { ValidationError, type TransactionDraft } from '../../../application/services/transaction-service.ts';
import { addDays, formatThaiShort } from '../../../domain/dates.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import { formatBaht } from '../../../domain/money.ts';
import { describeRuleThai } from '../../../domain/recurrence.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import type { HandlerContext } from '../context.ts';
import { pb } from '../flex/actions.ts';
import { flex, mascotSays } from '../flex/common.ts';
import { BRAND, bubble, button, card, header, row, sep, txt } from '../flex/theme.ts';
import { mascotUrl } from '../mascot.ts';

export const EDIT_KIND = 'edit';
export const EDIT_PICK_KIND = 'edit_pick';

interface EditTarget extends EntityCandidate {
  /** budget category id (budgets are edited by category) */
  extra?: string;
}

interface EditPayload {
  intent: EditIntent;
  target: EditTarget;
}

async function gather(ctx: HandlerContext, intent: EditIntent): Promise<EditTarget[]> {
  const { repos } = ctx.deps;
  const fixedOnly = intent.action === 'set_day' || intent.action === 'pause' || intent.action === 'resume';
  const out: EditTarget[] = [];
  if (intent.scope !== 'goal' && intent.scope !== 'budget') {
    for (const f of await repos.fixedCosts.list(ctx.userId)) out.push({ kind: 'fixed_cost', id: f.id, name: f.name, amountSatang: f.amountSatang });
  }
  if (fixedOnly) return out;
  if (intent.scope !== 'budget') {
    for (const g of await repos.goals.listActive(ctx.userId)) {
      out.push({ kind: 'goal', id: g.id, name: g.name, amountSatang: intent.action === 'set_reserve' ? g.monthlyReserveSatang : g.targetSatang });
    }
  }
  if (intent.scope !== 'goal') { // (set_reserve always has scope 'goal')
    for (const b of await repos.budgets.list(ctx.userId)) {
      out.push({ kind: 'budget', id: b.id, name: b.categoryId === 'total' ? 'งบรวม' : getCategory(b.categoryId).labelTh, amountSatang: b.limitSatang, extra: b.categoryId });
    }
  }
  return out;
}

async function recentTransactions(ctx: HandlerContext): Promise<EditTarget[]> {
  const rows = await ctx.deps.repos.transactions.listByRange(ctx.userId, addDays(ctx.today, -14), ctx.today);
  return rows.filter((t) => t.note && t.type !== 'saving').reverse().map((t) => ({ kind: 'transaction', id: t.id, name: t.note!, amountSatang: t.amountSatang }));
}

const KIND_LABEL: Record<EditTarget['kind'], string> = { fixed_cost: 'บิลประจำ', goal: 'เป้าหมายออม', budget: 'งบ', transaction: 'รายการ' };

function describe(intent: EditIntent, t: EditTarget): { title: string; lines: Array<[string, string]>; warning: string | null } {
  const cur = t.amountSatang;
  switch (intent.action) {
    case 'set_amount': {
      const label = t.kind === 'goal' ? 'ยอดเป้าหมาย' : t.kind === 'budget' ? 'งบต่อเดือน' : 'ยอด';
      const lines: Array<[string, string]> = [[label, `${cur !== undefined ? formatBaht(cur) : '-'} → ${formatBaht(intent.newAmount)}`]];
      const warning = intent.oldAmount !== null && cur !== undefined && intent.oldAmount !== cur ? `ตอนนี้ตั้งไว้ ${formatBaht(cur)} (ไม่ใช่ ${formatBaht(intent.oldAmount)}) ถ้าจะเปลี่ยนเป็น ${formatBaht(intent.newAmount)} ก็กดยืนยันได้เลย` : null;
      return { title: `เปลี่ยน${label}`, lines, warning };
    }
    case 'set_reserve':
      return { title: 'เปลี่ยนยอดออมต่อเดือน', lines: [['ออมต่อเดือน', `${cur !== undefined ? formatBaht(cur) : '-'} → ${formatBaht(intent.newAmount)}`]], warning: null };
    case 'set_day':
      return { title: 'เปลี่ยนวันครบกำหนด', lines: [['ครบกำหนด', `ทุกวันที่ ${intent.day}`]], warning: intent.day > 28 ? 'เดือนที่ไม่มีวันนี้จะใช้วันสุดท้ายของเดือนแทน' : null };
    case 'pause':
      return { title: 'หยุดชั่วคราว', lines: [['ผล', 'ไม่เตือนและไม่หักยอดงวดถัดไป']], warning: null };
    case 'resume':
      return { title: 'เริ่มใหม่', lines: [['ผล', 'กลับมาเตือนและหักยอดตามรอบ']], warning: null };
    case 'delete':
      return {
        title: t.kind === 'goal' ? 'เก็บเป้าหมาย' : 'ลบ',
        lines: [['ผล', t.kind === 'fixed_cost' ? 'บิลงวดต่อไปหายไป (ประวัติที่จ่ายแล้วยังอยู่)' : t.kind === 'transaction' ? 'ลบรายการนี้ (กดเอากลับได้)' : 'ลบออก']],
        warning: null,
      };
  }
}

async function proposeEdit(ctx: HandlerContext, intent: EditIntent, target: EditTarget): Promise<Message[]> {
  if (intent.action === 'set_day' && target.kind === 'fixed_cost') {
    const fc = await ctx.deps.repos.fixedCosts.get(ctx.userId, target.id);
    if (fc && fc.frequency !== 'monthly') return [mascotSays(`"${fc.name}" เป็นบิล${describeRuleThai({ frequency: fc.frequency, interval: fc.interval, anchorDate: fc.anchorDate })} เปลี่ยนวันได้เฉพาะบิลรายเดือนนะ ลองลบแล้วเพิ่มใหม่ได้`, 'thinking')];
  }
  const pending = await ctx.deps.repos.pending.create<EditPayload>(ctx.userId, EDIT_KIND, { intent, target }, 30);
  const d = describe(intent, target);
  return [
    flex(`${d.title} ${target.name}?`, bubble({
      header: header(`แก้ไข${KIND_LABEL[target.kind]}`, target.name, mascotUrl('thinking')),
      body: [
        card([txt(d.title, { weight: 'bold' }), sep({ margin: 'sm' }), ...d.lines.map(([k, v]) => row(k, v, { bold: true }))]),
        ...(d.warning ? [txt(d.warning, { size: 'xs', color: BRAND.deepRed })] : []),
      ],
      footer: [
        button(pb('✅ ยืนยัน', 'edit_confirm', { id: pending.id }, { displayText: 'ยืนยัน' })),
        button(pb('ไม่ใช่', 'draft_cancel', { id: pending.id }, { displayText: 'ไม่ใช่' }), 'link'),
      ],
    })),
  ];
}

async function askWhich(ctx: HandlerContext, intent: EditIntent, options: ScoredCandidate[] | EditTarget[], notFound: boolean): Promise<Message[]> {
  const opts = options.slice(0, 12) as EditTarget[];
  if (opts.length === 0) return [mascotSays(`ไม่เจอรายการชื่อ "${intent.target}" เลย ลองพิมพ์ชื่อให้ตรงกับที่ตั้งไว้ หรือดูรายการในเมนูค่าใช้จ่ายประจำนะ`, 'thinking', [pb('ค่าใช้จ่ายประจำ', 'fixed_costs'), pb('งบประมาณ', 'budgets')])];
  const pending = await ctx.deps.repos.pending.create(ctx.userId, EDIT_PICK_KIND, { intent, options: opts }, 30);
  return [
    text(
      notFound ? `ไม่เจอ "${intent.target}" ตรงๆ หมายถึงอันไหนเอ่ย? 🤔` : `"${intent.target}" มีหลายอันที่คล้ายกัน หมายถึงอันไหน?`,
      quickReply([
        ...opts.map((o, i) => pb(`${o.name}${o.amountSatang !== undefined ? ` ${formatBaht(o.amountSatang)}` : ''}`, 'edit_pick', { id: pending.id, i }, { displayText: o.name })),
        pb('ไม่ใช่ทั้งหมด', 'draft_cancel', { id: pending.id }, { displayText: 'ไม่ใช่ทั้งหมด' }),
      ]),
    ),
  ];
}

export async function handleEdit(ctx: HandlerContext, intent: EditIntent): Promise<Message[]> {
  const candidates = await gather(ctx, intent);
  let r = resolve(intent.target, candidates);
  if (r.status === 'none' && (intent.action === 'set_amount' || intent.action === 'delete') && intent.scope === null) {
    r = resolve(intent.target, await recentTransactions(ctx)); // "แก้กาแฟเป็น 90"
  }
  if (r.status === 'unique') return proposeEdit(ctx, intent, r.match as EditTarget);
  if (r.status === 'ambiguous') return askWhich(ctx, intent, r.options, false);
  return askWhich(ctx, intent, candidates.filter((c) => c.kind === 'fixed_cost'), true);
}

export async function pickEditTarget(ctx: HandlerContext, pendingId: string, index: number): Promise<Message[] | null> {
  const won = await ctx.deps.repos.pending.resolve<{ intent: EditIntent; options: EditTarget[] }>(ctx.userId, pendingId, 'confirmed');
  if (!won || won.kind !== EDIT_PICK_KIND) return null;
  const target = won.payload.options[index];
  if (!target) return null;
  return proposeEdit(ctx, won.payload.intent, target);
}

export async function confirmEdit(ctx: HandlerContext, pendingId: string): Promise<Message[] | null> {
  const won = await ctx.deps.repos.pending.resolve<EditPayload>(ctx.userId, pendingId, 'confirmed');
  if (!won || won.kind !== EDIT_KIND) return null;
  const { intent, target } = won.payload;
  const { deps, userId, today } = ctx;
  const done = (msg: string) => [mascotSays(msg, 'happy', [pb('ค่าใช้จ่ายประจำ', 'fixed_costs'), pb('ภาพรวม', 'dashboard')])];
  try {
    if (target.kind === 'fixed_cost') {
      switch (intent.action) {
        case 'set_amount':
          return (await deps.fixedCosts.updateAmount(userId, target.id, intent.newAmount, today)) ? done(`เปลี่ยน "${target.name}" เป็น ${formatBaht(intent.newAmount)} แล้ว ✓ บิลที่ยังไม่จ่ายใช้ยอดใหม่ด้วย`) : null;
        case 'set_day': {
          const r = await deps.fixedCosts.changeDay(userId, target.id, intent.day, today);
          return r.ok ? done(`เปลี่ยน "${target.name}" เป็นทุกวันที่ ${intent.day} แล้ว ✓ งวดถัดไป ${formatThaiShort(r.nextDue, true)}`) : null;
        }
        case 'pause':
          return (await deps.fixedCosts.pause(userId, target.id, today)) ? done(`หยุด "${target.name}" ชั่วคราวแล้ว`) : [mascotSays(`"${target.name}" หยุดอยู่แล้วน้า`, 'smart')];
        case 'resume':
          return (await deps.fixedCosts.resume(userId, target.id, today)) ? done(`เริ่ม "${target.name}" ใหม่แล้ว`) : [mascotSays(`"${target.name}" ยังทำงานอยู่นะ`, 'smart')];
        case 'delete':
          return (await deps.fixedCosts.remove(userId, target.id, today)) ? done(`ลบ "${target.name}" แล้ว`) : null;
      }
    }
    if (target.kind === 'goal') {
      if (intent.action === 'set_amount') return (await deps.repos.goals.update(userId, target.id, { targetSatang: intent.newAmount })) ? done(`เป้า "${target.name}" เป็น ${formatBaht(intent.newAmount)} แล้ว ✓`) : null;
      if (intent.action === 'set_reserve') return (await deps.repos.goals.update(userId, target.id, { monthlyReserveSatang: intent.newAmount })) ? done(`ออม "${target.name}" เดือนละ ${formatBaht(intent.newAmount)} แล้ว ✓`) : null;
      if (intent.action === 'delete') return (await deps.finance.archiveGoal(userId, target.id)) ? done(`เก็บเป้า "${target.name}" แล้ว`) : null;
    }
    if (target.kind === 'budget') {
      if (intent.action === 'set_amount' && target.extra) {
        await deps.finance.setBudget(userId, target.extra, intent.newAmount);
        return done(`งบ${target.name} เป็น ${formatBaht(intent.newAmount)} ต่อเดือนแล้ว ✓`);
      }
      if (intent.action === 'delete') return (await deps.finance.deleteBudget(userId, target.id)) ? done(`ลบงบ${target.name}แล้ว`) : null;
    }
    if (target.kind === 'transaction') {
      if (intent.action === 'set_amount') {
        const t = await deps.txns.editAmount(userId, target.id, intent.newAmount, today);
        return t ? done(`แก้ "${target.name}" เป็น ${formatBaht(intent.newAmount)} แล้ว ✓`) : null;
      }
      if (intent.action === 'delete') {
        const t = await deps.txns.remove(userId, target.id);
        return t ? [mascotSays(`ลบ "${target.name}" แล้ว`, 'happy', [pb('↩️ เอากลับมา', 'txn_undo', { id: t.id })])] : null;
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) return [mascotSays(e.message, 'thinking')];
    throw e;
  }
  return [mascotSays('อันนี้ทำแบบนั้นไม่ได้น้า', 'thinking')];
}

/**
 * "ค่าห้อง 6500" when the user has a bill named ค่าห้อง: ask whether this pays the bill, is a normal
 * expense, or should change the bill's amount. Returns null when no bill matches confidently.
 */
export async function billChoice(ctx: HandlerContext, draft: TransactionDraft): Promise<Message[] | null> {
  if (draft.type !== 'expense' || !draft.note || draft.source !== 'chat') return null;
  const costs = await ctx.deps.repos.fixedCosts.list(ctx.userId);
  const r = resolve(draft.note, costs.filter((c) => c.status === 'active').map((c) => ({ kind: 'fixed_cost' as const, id: c.id, name: c.name, amountSatang: c.amountSatang })));
  if (r.status !== 'unique' || r.match.score < 0.8) return null;
  const fc = costs.find((c) => c.id === r.match.id)!;
  const occ = (await ctx.deps.repos.fixedCosts.listOccurrencesForPeriod(ctx.userId, ctx.today, addDays(ctx.today, 45)))
    .filter((o) => o.fixedCostId === fc.id && o.status === 'pending')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const txnDraft = await ctx.deps.txns.createDraft(ctx.userId, { ...draft, categoryId: fc.categoryId, categoryConfident: true }, ctx.today);
  const changeAmount = draft.amountSatang !== fc.amountSatang;
  const edit = changeAmount
    ? await ctx.deps.repos.pending.create<EditPayload>(ctx.userId, EDIT_KIND, { intent: { kind: 'edit', action: 'set_amount', target: fc.name, newAmount: draft.amountSatang, oldAmount: null, scope: 'fixed_cost' }, target: { kind: 'fixed_cost', id: fc.id, name: fc.name, amountSatang: fc.amountSatang } }, 30)
    : null;
  return [
    flex(`นี่คือ ${fc.name} ใช่ไหม?`, bubble({
      header: header('ชิกชิกขอเช็คนิดนึง', `${fc.name} ใช่ไหม?`, mascotUrl('thinking')),
      body: [
        card([
          row('ที่พิมพ์มา', formatBaht(draft.amountSatang), { bold: true }),
          row('บิลที่ตั้งไว้', `${formatBaht(fc.amountSatang)} · ${describeRuleThai({ frequency: fc.frequency, interval: fc.interval, anchorDate: fc.anchorDate })}`),
          ...(occ ? [row('งวดที่ค้าง', formatThaiShort(occ.dueDate, true))] : []),
        ]),
      ],
      footer: [
        ...(occ ? [button(pb(`✅ จ่ายบิลงวดนี้ ${formatBaht(draft.amountSatang)}`, 'fc_pay_amount', { id: occ.id, amt: draft.amountSatang }, { displayText: `จ่าย ${fc.name}` }))] : []),
        button(pb('📝 จดเป็นรายจ่ายทั่วไป', 'txn_confirm', { id: txnDraft.id }, { displayText: 'จดเป็นรายจ่ายทั่วไป' }), occ ? 'secondary' : 'primary'),
        ...(edit ? [button(pb(`✏️ เปลี่ยนยอดบิลเป็น ${formatBaht(draft.amountSatang)}`, 'edit_confirm', { id: edit.id }, { displayText: 'เปลี่ยนยอดบิล' }), 'link')] : []),
      ],
    })),
  ];
}
