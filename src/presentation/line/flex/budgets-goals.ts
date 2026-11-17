/**
 * Budget and savings-goal templates.
 */
import type { BudgetStatus } from '../../../domain/calculations/budget.ts';
import type { SavingsProgress } from '../../../domain/calculations/savings.ts';
import { categoriesOfKind, getCategory } from '../../../domain/entities/categories.ts';
import { TOTAL_BUDGET_CATEGORY } from '../../../domain/entities/index.ts';
import { formatBaht } from '../../../domain/money.ts';
import type { GoalProposal } from '../../../application/parser/setup-parsers.ts';
import type { FlexComponent, FlexMessage, Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { mascotUrl, moodForBudget } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, progressBar, row, sep, txt, vbox } from './theme.ts';

const LEVEL_COLOR = { ok: BRAND.green, warning: '#F2A93B', exceeded: BRAND.red } as const;

export function budgetLabel(categoryId: string): string {
  if (categoryId === TOTAL_BUDGET_CATEGORY) return '🧺 งบรวมทั้งเดือน';
  const c = getCategory(categoryId);
  return `${c.emoji} ${c.labelTh}`;
}

export function budgetRow(s: BudgetStatus): FlexComponent {
  const pct = Math.floor(s.usedBasisPoints / 100);
  return vbox(
    [
      hbox([
        txt(budgetLabel(s.budget.categoryId), { size: 'sm', flex: 6 }),
        txt(`${pct}%`, { size: 'sm', align: 'end', flex: 2, weight: 'bold', color: LEVEL_COLOR[s.level] }),
      ]),
      progressBar(s.usedBasisPoints, LEVEL_COLOR[s.level]),
      txt(
        s.remainingSatang >= 0
          ? `ใช้ ${formatBaht(s.spentSatang)} / ${formatBaht(s.budget.limitSatang)} · เหลือ ${formatBaht(s.remainingSatang)}`
          : `ใช้ ${formatBaht(s.spentSatang)} / ${formatBaht(s.budget.limitSatang)} · เกิน ${formatBaht(-s.remainingSatang)}`,
        { size: 'xxs', color: BRAND.muted },
      ),
    ],
    { spacing: 'xs' },
  );
}

export function budgetsOverviewMessage(statuses: BudgetStatus[], periodTitle: string): FlexMessage {
  if (statuses.length === 0) {
    return flex(
      'ยังไม่ได้ตั้งงบ',
      bubble({
        header: header('งบประมาณ', 'ยังไม่ได้ตั้งงบ', mascotUrl('planning')),
        body: [txt('ตั้งงบรายหมวด เช่น อาหารเดือนละ 6,000 แล้วชิกชิกจะเตือนเมื่อใช้ถึง 50%, 80% และ 100%')],
        footer: [button(pb('➕ ตั้งงบ', 'budget_add')), button(pb('🎯 เป้าหมายออม', 'goals'), 'secondary')],
      }),
    );
  }
  const worst = statuses[0]!.level;
  return flex(
    'งบประมาณ',
    bubble({
      header: header('งบประมาณ', periodTitle, mascotUrl(moodForBudget(worst))),
      body: [
        card(
          statuses.slice(0, 8).map((s) => vbox([budgetRow(s)], { action: pb('จัดการ', 'budget_delete', { id: s.budget.id }) })),
          { spacing: 'lg' },
        ),
        txt('แตะที่งบเพื่อลบ · ตั้งหมวดเดิมซ้ำเพื่อแก้ยอด', { size: 'xxs', color: BRAND.muted, align: 'center' }),
      ],
      footer: [hbox([button(pb('➕ ตั้งงบ', 'budget_add'), 'primary', { flex: 1 }), button(pb('🎯 เป้าหมายออม', 'goals'), 'secondary', { flex: 1 })], { spacing: 'sm' })],
    }),
  );
}

export function budgetCategoryPickerMessage(): Message {
  return text(
    'ตั้งงบหมวดไหนดี? 👇',
    quickReply([
      pb('🧺 งบรวม', 'budget_pick_category', { c: TOTAL_BUDGET_CATEGORY }, { displayText: 'งบรวม', inputOption: 'openKeyboard' }),
      ...categoriesOfKind('expense')
        .slice(0, 11)
        .map((c) => pb(`${c.emoji} ${c.labelTh}`, 'budget_pick_category', { c: c.id }, { displayText: `${c.emoji} ${c.labelTh}`, inputOption: 'openKeyboard' })),
      pb('ยกเลิก', 'cancel_flow', {}, { displayText: 'ยกเลิก' }),
    ]),
  );
}

export function budgetWarningMessage(s: BudgetStatus, threshold: number, comment: string): FlexMessage {
  const exceeded = threshold >= 100;
  return flex(
    `${budgetLabel(s.budget.categoryId)} ใช้ไปแล้ว ${Math.floor(s.usedBasisPoints / 100)}%`,
    bubble({
      size: 'kilo',
      header: header(exceeded ? 'เกินงบแล้ว!' : 'เตือนงบ', `${budgetLabel(s.budget.categoryId)} ${Math.floor(s.usedBasisPoints / 100)}%`, mascotUrl(exceeded ? 'angry' : 'worried'), {
        bg: exceeded ? BRAND.deepRed : BRAND.red,
      }),
      body: [budgetRow(s), txt(comment, { size: 'sm' })],
      footer: [button(pb('ดูงบทั้งหมด', 'budgets'), 'secondary')],
    }),
  );
}

export function goalsOverviewMessage(goals: SavingsProgress[]): FlexMessage {
  if (goals.length === 0) {
    return flex(
      'ยังไม่มีเป้าหมายออม',
      bubble({
        header: header('เป้าหมายออม', 'ยังไม่มีเป้าหมาย', mascotUrl('saving')),
        body: [txt('ตั้งเป้าแล้วชิกชิกจะกันเงินออมรายเดือนไว้ให้ก่อนคำนวณยอดใช้ได้'), card([txt('ตัวอย่าง', { size: 'xs', color: BRAND.muted }), txt('เที่ยวญี่ปุ่น 30000 เดือนละ 3000', { weight: 'bold', color: BRAND.deepRed })])],
        footer: [button(pb('➕ ตั้งเป้าหมาย', 'goal_add', {}, { inputOption: 'openKeyboard' }))],
      }),
    );
  }
  const items = goals.slice(0, 6).map((g) =>
    vbox(
      [
        hbox([txt(`🎯 ${g.goal.name}`, { weight: 'bold', size: 'sm', flex: 6 }), txt(`${Math.floor(g.progressBasisPoints / 100)}%`, { size: 'sm', align: 'end', flex: 2, weight: 'bold', color: BRAND.deepRed })]),
        progressBar(g.progressBasisPoints, g.isReached ? BRAND.green : BRAND.yellow),
        txt(
          g.isReached
            ? `ถึงเป้าแล้ว! ${formatBaht(g.savedSatang)} 🎉`
            : `${formatBaht(g.savedSatang)} / ${formatBaht(g.goal.targetSatang)}${g.periodsToGoal ? ` · อีกราว ${g.periodsToGoal} เดือน` : ''}`,
          { size: 'xxs', color: BRAND.muted },
        ),
        hbox([
          button(pb('🐷 ออมเพิ่ม', 'goal_contribute', { id: g.goal.id }, { inputOption: 'openKeyboard' }), 'secondary', { flex: 1 }),
          button(pb('เก็บเข้ากรุ', 'goal_archive', { id: g.goal.id }, { displayText: `เก็บเป้าหมาย ${g.goal.name}` }), 'link', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
      { spacing: 'xs' },
    ),
  );
  return flex(
    'เป้าหมายออม',
    bubble({
      header: header('เป้าหมายออม', `${goals.length} เป้าหมาย`, mascotUrl(goals.some((g) => g.isReached) ? 'celebrating' : 'saving')),
      body: [card(items, { spacing: 'lg' })],
      footer: [button(pb('➕ ตั้งเป้าหมายใหม่', 'goal_add', {}, { inputOption: 'openKeyboard' }))],
    }),
  );
}

export function goalAddPrompt(): Message {
  return text(
    'ตั้งเป้าหมายออม 🎯\nพิมพ์ ชื่อเป้าหมาย + ยอดเป้า (+ เดือนละเท่าไหร่) เช่น\n• เที่ยวญี่ปุ่น 30000 เดือนละ 3000\n• เงินสำรองฉุกเฉิน 1 แสน',
    quickReply([pb('ยกเลิก', 'cancel_flow', {}, { displayText: 'ยกเลิก' })]),
  );
}

export function confirmGoalMessage(draftId: string, p: GoalProposal): FlexMessage {
  return flex(
    `ตั้งเป้า ${p.name} ${formatBaht(p.targetSatang)}?`,
    bubble({
      header: header('ตั้งเป้าหมายออม', 'แบบนี้ใช่ไหม?', mascotUrl('saving')),
      body: [
        card([
          txt(`🎯 ${p.name}`, { weight: 'bold' }),
          txt(formatBaht(p.targetSatang), { size: 'xxl', weight: 'bold' }),
          sep({ margin: 'md' }),
          row('กันไว้ออมต่อเดือน', p.monthlyReserveSatang ? formatBaht(p.monthlyReserveSatang) : 'ไม่กำหนด'),
          ...(p.monthlyReserveSatang ? [row('ใช้เวลาราว', `${Math.ceil(p.targetSatang / p.monthlyReserveSatang)} เดือน`)] : []),
        ]),
        ...(p.monthlyReserveSatang ? [txt('ยอดกันไว้ออมจะถูกหักจาก "ใช้ได้อีก" จนกว่าจะออมครบในเดือนนั้น', { size: 'xs', color: BRAND.muted })] : []),
      ],
      footer: [
        button(pb('✅ ตั้งเป้าเลย', 'goal_create_confirm', { id: draftId }, { displayText: 'ตั้งเป้าเลย' })),
        button(pb('ยกเลิก', 'draft_cancel', { id: draftId }, { displayText: 'ยกเลิก' }), 'link'),
      ],
    }),
  );
}
