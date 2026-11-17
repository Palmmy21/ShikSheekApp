/**
 * Fixed Cost templates: overview, detail, pay confirmation, upcoming bills, reminders, create-confirm.
 */
import { formatThaiShort, type LocalDate } from '../../../domain/dates.ts';
import type { OccurrenceView } from '../../../domain/calculations/bills.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import type { FixedCost, FixedCostOccurrence } from '../../../domain/entities/index.ts';
import { formatBaht } from '../../../domain/money.ts';
import { deriveOccurrenceStatus, describeRuleThai, type OccurrenceDisplayStatus } from '../../../domain/recurrence.ts';
import type { FixedCostSummary } from '../../../application/services/fixed-cost-service.ts';
import { ruleOf } from '../../../application/services/fixed-cost-service.ts';
import type { FixedCostProposal } from '../../../application/parser/setup-parsers.ts';
import type { FlexComponent, FlexMessage, Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, pill, row, sep, txt, vbox } from './theme.ts';

const STATUS: Record<OccurrenceDisplayStatus, { label: string; bg: string; color: string }> = {
  upcoming: { label: 'รอจ่าย', bg: BRAND.softYellow, color: BRAND.brown },
  due: { label: 'ครบกำหนดวันนี้', bg: BRAND.red, color: BRAND.white },
  overdue: { label: 'เลยกำหนด', bg: BRAND.deepRed, color: BRAND.white },
  paid: { label: 'จ่ายแล้ว', bg: '#DDF3E7', color: BRAND.green },
  skipped: { label: 'ข้าม', bg: BRAND.track, color: BRAND.muted },
};

export const statusPill = (s: OccurrenceDisplayStatus) => pill(STATUS[s].label, STATUS[s].bg, STATUS[s].color);

function dueText(o: OccurrenceView): string {
  if (o.displayStatus === 'due') return 'วันนี้';
  if (o.displayStatus === 'overdue') return `เลยมา ${-o.daysUntilDue} วัน`;
  if (o.daysUntilDue === 1) return 'พรุ่งนี้';
  return `${formatThaiShort(o.dueDate)} (อีก ${o.daysUntilDue} วัน)`;
}

/** One-line bill summary used by dashboard and lists. */
export function billLine(o: OccurrenceView, name: string): FlexComponent {
  return hbox(
    [
      vbox([txt(name, { size: 'sm', weight: 'bold' }), txt(dueText(o), { size: 'xxs', color: o.displayStatus === 'overdue' ? BRAND.red : BRAND.muted })], { flex: 6 }),
      txt(formatBaht(o.amountSatang), { size: 'sm', align: 'end', flex: 4, gravity: 'center', weight: 'bold' }),
    ],
    o.id ? { action: pb('จ่าย', 'fc_pay', { id: o.id }) } : {},
  );
}

export function fixedCostOverviewMessage(items: FixedCostSummary[]): FlexMessage {
  if (items.length === 0) {
    return flex(
      'ยังไม่มีค่าใช้จ่ายประจำ',
      bubble({
        header: header('ค่าใช้จ่ายประจำ', 'ยังไม่มีเลย', mascotUrl('planning')),
        body: [
          txt('เพิ่มบิลที่ต้องจ่ายทุกเดือน เช่น ค่าห้อง ค่าเน็ต ค่าผ่อน แล้วชิกชิกจะหักออกจากยอดใช้ได้และเตือนก่อนถึงกำหนด'),
          card([txt('ตัวอย่าง', { size: 'xs', color: BRAND.muted }), txt('ค่าเน็ต 599 ทุกวันที่ 5', { weight: 'bold', color: BRAND.deepRed }), txt('ยิม 300 ทุกวันจันทร์', { weight: 'bold', color: BRAND.deepRed })]),
        ],
        footer: [button(pb('➕ เพิ่มค่าใช้จ่ายประจำ', 'fc_add', {}, { inputOption: 'openKeyboard' }))],
      }),
    );
  }
  const rows = items.slice(0, 12).map(({ fixedCost: fc, next, overdue }) => {
    const status: OccurrenceDisplayStatus | null = overdue.length ? 'overdue' : next ? next.displayStatus : null;
    return hbox(
      [
        txt(getCategory(fc.categoryId).emoji, { flex: 0 }),
        vbox(
          [
            txt(fc.name, { size: 'sm', weight: 'bold', color: fc.status === 'paused' ? BRAND.muted : BRAND.brown }),
            txt(fc.status === 'paused' ? 'หยุดชั่วคราว' : next ? `ครั้งถัดไป ${formatThaiShort(next.dueDate)}` : describeRuleThai(ruleOf(fc)), { size: 'xxs', color: BRAND.muted }),
          ],
          { flex: 6 },
        ),
        vbox([txt(formatBaht(fc.amountSatang), { size: 'sm', weight: 'bold', align: 'end' }), ...(status && fc.status === 'active' ? [hbox([{ type: 'filler' }, statusPill(status)])] : [])], { flex: 4, spacing: 'xs' }),
      ],
      { spacing: 'md', action: pb('ดู', 'fc_detail', { id: fc.id }), paddingTop: '6px', paddingBottom: '6px' },
    );
  });
  const monthly = items.filter((i) => i.fixedCost.status === 'active' && i.fixedCost.frequency === 'monthly' && i.fixedCost.interval === 1).reduce((s, i) => s + i.fixedCost.amountSatang, 0);
  return flex(
    'ค่าใช้จ่ายประจำ',
    bubble({
      header: header('ค่าใช้จ่ายประจำ', `${items.length} รายการ`, mascotUrl('discipline'), monthly ? { subtitle: `รายเดือนรวม ${formatBaht(monthly)}` } : {}),
      body: [card(rows, { spacing: 'none' }), txt('แตะที่รายการเพื่อดู/จ่าย/หยุด', { size: 'xxs', color: BRAND.muted, align: 'center' })],
      footer: [
        hbox([
          button(pb('➕ เพิ่ม', 'fc_add', {}, { inputOption: 'openKeyboard' }), 'primary', { flex: 1 }),
          button(pb('📅 บิลใกล้ถึง', 'fc_bills'), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
    }),
  );
}

export function fixedCostDetailMessage(fc: FixedCost, recent: FixedCostOccurrence[], today: LocalDate): FlexMessage {
  const views = recent.map((o) => ({ ...o, displayStatus: deriveOccurrenceStatus(o.status, o.dueDate, today) }));
  const actionable = [...views].reverse().find((o) => o.status === 'pending');
  const history = views.slice(0, 5).map((o) =>
    hbox([txt(formatThaiShort(o.dueDate, true), { size: 'xs', flex: 4 }), txt(formatBaht(o.amountSatang), { size: 'xs', flex: 3, align: 'end' }), hbox([{ type: 'filler' }, statusPill(o.displayStatus)], { flex: 4 })], { alignItems: 'center' }),
  );
  const footer: FlexComponent[] = [];
  if (actionable && fc.status === 'active') {
    footer.push(button(pb(`✅ จ่ายงวด ${formatThaiShort(actionable.dueDate)}`, 'fc_pay', { id: actionable.id })));
    footer.push(button(pb('ข้ามงวดนี้', 'fc_skip', { id: actionable.id }, { displayText: 'ข้ามงวดนี้' }), 'secondary'));
  }
  footer.push(
    hbox([
      fc.status === 'active'
        ? button(pb('⏸ หยุดชั่วคราว', 'fc_pause', { id: fc.id }, { displayText: 'หยุดชั่วคราว' }), 'secondary', { flex: 1 })
        : button(pb('▶️ เริ่มใหม่', 'fc_resume', { id: fc.id }, { displayText: 'เริ่มใหม่' }), 'secondary', { flex: 1 }),
      button(pb('🗑️ ลบ', 'fc_delete', { id: fc.id }), 'secondary', { flex: 1 }),
    ], { spacing: 'sm' }),
  );
  return flex(
    `ค่าใช้จ่ายประจำ: ${fc.name}`,
    bubble({
      header: header('ค่าใช้จ่ายประจำ', fc.name, mascotUrl('planning'), { subtitle: fc.status === 'paused' ? 'หยุดชั่วคราว' : describeRuleThai(ruleOf(fc)) }),
      body: [
        card([
          txt('ยอดต่องวด', { size: 'xs', color: BRAND.muted }),
          txt(formatBaht(fc.amountSatang), { size: 'xxl', weight: 'bold' }),
          sep({ margin: 'md' }),
          row('หมวด', `${getCategory(fc.categoryId).emoji} ${getCategory(fc.categoryId).labelTh}`),
          row('เตือนล่วงหน้า', fc.remindDaysBefore ? `${fc.remindDaysBefore} วัน` : 'วันที่ครบกำหนด'),
        ]),
        ...(history.length ? [card([txt('งวดล่าสุด', { weight: 'bold', size: 'sm' }), ...history])] : []),
      ],
      footer,
    }),
  );
}

export function payConfirmMessage(occurrence: FixedCostOccurrence, fc: FixedCost, today: LocalDate): FlexMessage {
  const status = deriveOccurrenceStatus(occurrence.status, occurrence.dueDate, today);
  return flex(
    `ยืนยันจ่าย ${fc.name} ${formatBaht(occurrence.amountSatang)}?`,
    bubble({
      header: header('จ่ายบิล', fc.name, mascotUrl('smart')),
      body: [
        card([
          txt('ยอดที่ต้องจ่าย', { size: 'xs', color: BRAND.muted }),
          txt(formatBaht(occurrence.amountSatang), { size: '3xl', weight: 'bold' }),
          hbox([txt(`ครบกำหนด ${formatThaiShort(occurrence.dueDate, true)}`, { size: 'xs', color: BRAND.muted, flex: 1 }), statusPill(status)], { alignItems: 'center' }),
        ]),
        txt('กดยืนยันแล้วชิกชิกจะบันทึกเป็นรายจ่ายวันนี้ให้ และบิลนี้จะไม่ถูกหักซ้ำ', { size: 'xs', color: BRAND.muted }),
      ],
      footer: [
        button(pb(`✅ จ่ายแล้ว ${formatBaht(occurrence.amountSatang)}`, 'fc_pay_confirm', { id: occurrence.id }, { displayText: 'จ่ายแล้ว' })),
        button(pb('จ่ายไม่เท่านี้', 'fc_pay_custom', { id: occurrence.id }, { inputOption: 'openKeyboard' }), 'secondary'),
        button(pb('ยังไม่จ่าย', 'cancel_flow', {}, { displayText: 'ยังไม่จ่าย' }), 'link'),
      ],
    }),
  );
}

export function upcomingBillsMessage(bills: OccurrenceView[], names: Record<string, string>, title: string, kicker = 'บิลใกล้ถึง', mascot: 'discipline' | 'worried' | 'happy' = 'discipline'): FlexMessage {
  if (bills.length === 0) {
    return flex(title, bubble({ header: header(kicker, title, mascotUrl('happy')), body: [txt('ไม่มีบิลต้องจ่ายในช่วงนี้ สบายใจได้ 😌')], footer: [button(pb('ดูค่าใช้จ่ายประจำ', 'fixed_costs'), 'secondary')] }));
  }
  const total = bills.reduce((s, b) => s + b.amountSatang, 0);
  return flex(
    `${title}: ${bills.length} บิล รวม ${formatBaht(total)}`,
    bubble({
      header: header(kicker, title, mascotUrl(bills.some((b) => b.displayStatus === 'overdue') ? 'worried' : mascot), { subtitle: `รวม ${formatBaht(total)}` }),
      body: [card(bills.slice(0, 8).map((b) => billLine(b, names[b.fixedCostId] ?? 'บิล')), { spacing: 'md' }), txt('แตะที่บิลเพื่อบันทึกว่าจ่ายแล้ว', { size: 'xxs', color: BRAND.muted, align: 'center' })],
      footer: bills.length === 1 && bills[0]!.id ? [button(pb(`✅ จ่าย ${names[bills[0]!.fixedCostId] ?? 'บิล'}`, 'fc_pay', { id: bills[0]!.id }))] : [button(pb('ดูค่าใช้จ่ายประจำ', 'fixed_costs'), 'secondary')],
    }),
  );
}

export function fixedCostAddPrompt(): Message {
  return text(
    'เพิ่มค่าใช้จ่ายประจำ 📅\nพิมพ์ ชื่อ + จำนวนเงิน + ความถี่ เช่น\n• ค่าห้อง 6500 ทุกวันที่ 1\n• ค่าเน็ต 599 ทุกวันที่ 5\n• ยิม 300 ทุกวันจันทร์\n• ประกันรถ 18000 ทุกปี 10/3\n• ค่าน้ำดื่ม 60 ทุก 10 วัน',
    quickReply([pb('ยกเลิก', 'cancel_flow', {}, { displayText: 'ยกเลิก' })]),
  );
}

export function confirmFixedCostMessage(draftId: string, p: FixedCostProposal): FlexMessage {
  const cat = getCategory(p.categoryId);
  return flex(
    `เพิ่ม ${p.name} ${formatBaht(p.amountSatang)}?`,
    bubble({
      header: header('เพิ่มค่าใช้จ่ายประจำ', 'แบบนี้ใช่ไหม?', mascotUrl('thinking')),
      body: [
        card([
          txt(p.name, { weight: 'bold', size: 'md' }),
          txt(formatBaht(p.amountSatang), { size: 'xxl', weight: 'bold' }),
          sep({ margin: 'md' }),
          row('ความถี่', describeRuleThai(p.rule)),
          row('ครั้งแรก', formatThaiShort(p.firstDueDate, true)),
          row('หมวด', `${cat.emoji} ${cat.labelTh}`),
        ]),
        txt('ชิกชิกจะเตือนก่อนครบกำหนด 1 วัน และหักยอดที่ยังไม่จ่ายออกจาก "ใช้ได้อีก" ให้', { size: 'xs', color: BRAND.muted }),
      ],
      footer: [
        button(pb('✅ เพิ่มเลย', 'fc_create_confirm', { id: draftId }, { displayText: 'เพิ่มเลย' })),
        button(pb('ยกเลิก', 'draft_cancel', { id: draftId }, { displayText: 'ยกเลิก' }), 'link'),
      ],
    }),
  );
}

export function confirmDeleteFixedCostMessage(fc: FixedCost): Message {
  return text(
    `ลบ "${fc.name}" ใช่ไหม?\nประวัติที่จ่ายไปแล้วยังอยู่ แต่บิลงวดต่อไปจะหายไป`,
    quickReply([pb('🗑️ ลบเลย', 'fc_delete_confirm', { id: fc.id }, { displayText: 'ลบเลย' }), pb('ไม่ลบ', 'cancel_flow', {}, { displayText: 'ไม่ลบ' })]),
  );
}
