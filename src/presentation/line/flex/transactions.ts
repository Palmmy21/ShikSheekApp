/**
 * Transaction templates: confirmation, success, history, category picker, delete/undo.
 * All amounts arrive pre-calculated; templates only format.
 */
import { addDays, formatThaiShort, type LocalDate } from '../../../domain/dates.ts';
import { categoriesOfKind, getCategory } from '../../../domain/entities/categories.ts';
import type { Transaction } from '../../../domain/entities/index.ts';
import { formatBaht, type Satang } from '../../../domain/money.ts';
import type { TransactionDraft } from '../../../application/services/transaction-service.ts';
import type { FlexMessage, Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { mascotUrl, type MascotExpression } from '../mascot.ts';
import { datePicker, pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, pill, row, sep, txt, vbox } from './theme.ts';

const TYPE_LABEL = { expense: 'รายจ่าย', income: 'รายรับ', saving: 'เงินออม' } as const;

export function dateLabel(date: LocalDate, today: LocalDate): string {
  if (date === today) return `วันนี้ (${formatThaiShort(date)})`;
  if (date === addDays(today, -1)) return `เมื่อวาน (${formatThaiShort(date)})`;
  if (date === addDays(today, 1)) return `พรุ่งนี้ (${formatThaiShort(date)})`;
  return formatThaiShort(date, true);
}

const amountColor = (type: Transaction['type']) => (type === 'income' ? BRAND.green : type === 'saving' ? BRAND.deepRed : BRAND.brown);
const signed = (type: Transaction['type'], satang: Satang) => (type === 'income' ? `+${formatBaht(satang)}` : formatBaht(satang));

export function confirmTransactionMessage(draftId: string, d: TransactionDraft, today: LocalDate, goalName?: string): FlexMessage {
  const cat = getCategory(d.categoryId);
  const body = [
    card([
      txt(TYPE_LABEL[d.type], { size: 'xs', color: BRAND.muted }),
      txt(signed(d.type, d.amountSatang), { size: '3xl', weight: 'bold', color: amountColor(d.type) }),
      sep({ margin: 'md' }),
      row('หมวด', `${cat.emoji} ${cat.labelTh}`, { bold: true }),
      row('วันที่', dateLabel(d.txnDate, today)),
      ...(goalName ? [row('เป้าหมาย', goalName)] : []),
      ...(d.note ? [row('โน้ต', d.note)] : []),
    ]),
  ];
  if (!d.categoryConfident) body.push(hbox([pill('ชิกชิกไม่แน่ใจหมวด กด "เปลี่ยนหมวด" ได้นะ', BRAND.softYellow, BRAND.deepRed)]));
  if (d.txnDate > today) body.push(hbox([pill('รายการล่วงหน้า', BRAND.softRed, BRAND.deepRed)]));
  const fromDocument = d.source === 'slip' || d.source === 'pdf';
  if (fromDocument) body.push(txt('📎 อ่านจากเอกสาร — ตรวจยอดเงินและวันที่ให้ตรงก่อนกดยืนยันนะ', { size: 'xs', color: BRAND.deepRed }));

  return flex(
    `ยืนยัน${TYPE_LABEL[d.type]} ${formatBaht(d.amountSatang)}?`,
    bubble({
      header: header(fromDocument ? 'อ่านจากสลิป' : 'ยืนยันรายการ', 'จดแบบนี้ใช่ไหม?', mascotUrl(fromDocument ? 'smart' : 'thinking')),
      body,
      footer: [
        button(pb(`✅ ยืนยัน ${formatBaht(d.amountSatang)}`, 'txn_confirm', { id: draftId }, { displayText: 'ยืนยัน' })),
        ...(fromDocument && d.type !== 'saving'
          ? [button(pb(d.type === 'expense' ? '↔ เป็นรายรับ' : '↔ เป็นรายจ่าย', 'txn_set_type', { id: draftId, t: d.type === 'expense' ? 'income' : 'expense' }), 'secondary')]
          : []),
        hbox(
          [
            ...(d.type !== 'saving'
              ? [button(pb('เปลี่ยนหมวด', 'txn_change_category', { id: draftId }), 'secondary', { flex: 1 })]
              : []),
            button(datePicker('เปลี่ยนวันที่', 'txn_pick_date', { id: draftId }, d.txnDate, addDays(today, -366), addDays(today, 31)), 'secondary', { flex: 1 }),
          ],
          { spacing: 'sm' },
        ),
        button(pb('ยกเลิก', 'txn_cancel', { id: draftId }, { displayText: 'ยกเลิก' }), 'link'),
      ],
    }),
  );
}

export function categoryPickerMessage(draftId: string, type: 'income' | 'expense'): Message {
  const cats = categoriesOfKind(type).slice(0, 13);
  return text(
    'เลือกหมวดให้หน่อยน้า 👇',
    quickReply(cats.map((c) => pb(`${c.emoji} ${c.labelTh}`, 'txn_pick_category', { id: draftId, c: c.id }, { displayText: `${c.emoji} ${c.labelTh}` }))),
  );
}

/** Rich-menu "add" flow: pick a category first, then type the amount. */
export function startEntryMessage(type: 'income' | 'expense'): Message {
  const cats = categoriesOfKind(type).slice(0, 12);
  const prompt =
    type === 'expense'
      ? 'จดรายจ่าย ✍️\nพิมพ์มาได้เลย เช่น "กินข้าว 65" หรือเลือกหมวดด้านล่างแล้วพิมพ์แค่จำนวนเงิน'
      : 'จดรายรับ 💰\nพิมพ์มาได้เลย เช่น "ได้เงินเดือน 25000" หรือเลือกหมวดด้านล่างแล้วพิมพ์แค่จำนวนเงิน';
  return text(
    prompt,
    quickReply([
      ...cats.map((c) => pb(`${c.emoji} ${c.labelTh}`, 'txn_start_category', { t: type, c: c.id }, { displayText: `${c.emoji} ${c.labelTh}`, inputOption: 'openKeyboard' })),
      pb('ยกเลิก', 'cancel_flow', {}, { displayText: 'ยกเลิก' }),
    ]),
  );
}

export function askAmountMessage(categoryId: string): Message {
  const c = getCategory(categoryId);
  return text(`${c.emoji} ${c.labelTh} — เท่าไหร่ดี? พิมพ์จำนวนเงินมาได้เลย (เช่น 65)`, quickReply([pb('ยกเลิก', 'cancel_flow', {}, { displayText: 'ยกเลิก' })]));
}

export interface SavedExtras {
  todayExpenseSatang?: Satang;
  availableSatang?: Satang;
  dailyAllowanceSatang?: Satang;
}

export function transactionSavedMessage(t: Transaction, today: LocalDate, comment: string, mascot: MascotExpression, extras: SavedExtras = {}): FlexMessage {
  const cat = getCategory(t.categoryId);
  const stats = [];
  if (extras.todayExpenseSatang !== undefined) stats.push(row('วันนี้ใช้ไป', formatBaht(extras.todayExpenseSatang)));
  if (extras.availableSatang !== undefined) {
    stats.push(row('ใช้ได้อีก (รอบนี้)', formatBaht(extras.availableSatang), { bold: true, valueColor: extras.availableSatang < 0 ? BRAND.red : BRAND.brown }));
  }
  if (extras.dailyAllowanceSatang) stats.push(row('เฉลี่ยใช้ได้วันละ', formatBaht(extras.dailyAllowanceSatang)));
  return flex(
    `บันทึก${TYPE_LABEL[t.type]} ${formatBaht(t.amountSatang)} แล้ว`,
    bubble({
      header: header('บันทึกแล้ว ✓', `${cat.emoji} ${signed(t.type, t.amountSatang)}`, mascotUrl(mascot), {
        subtitle: `${cat.labelTh} · ${dateLabel(t.txnDate, today)}`,
      }),
      body: [txt(comment), ...(stats.length ? [card(stats)] : [])],
      footer: [
        hbox([
          button(pb('ดูภาพรวม', 'dashboard'), 'primary', { flex: 1 }),
          button(pb('↩️ ลบรายการนี้', 'txn_delete_confirm', { id: t.id }, { displayText: 'ลบรายการนี้' }), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
    }),
  );
}

export function historyMessage(items: Transaction[], page: number, hasMore: boolean, today: LocalDate): FlexMessage {
  const rows = items.map((t) => {
    const cat = getCategory(t.categoryId);
    return hbox(
      [
        txt(cat.emoji, { flex: 0, size: 'md' }),
        vbox([txt(t.note ?? cat.labelTh, { size: 'sm', weight: 'bold', maxLines: 1, wrap: false }), txt(dateLabel(t.txnDate, today), { size: 'xxs', color: BRAND.muted })], { flex: 6 }),
        txt(signed(t.type, t.amountSatang), { flex: 4, align: 'end', size: 'sm', weight: 'bold', color: amountColor(t.type), gravity: 'center' }),
      ],
      { spacing: 'md', action: pb('ลบ?', 'txn_delete', { id: t.id }), paddingTop: '6px', paddingBottom: '6px' },
    );
  });
  const nav = [];
  if (page > 0) nav.push(button(pb('← ใหม่กว่า', 'txn_history', { p: page - 1 }), 'secondary', { flex: 1 }));
  if (hasMore) nav.push(button(pb('เก่ากว่า →', 'txn_history', { p: page + 1 }), 'secondary', { flex: 1 }));
  return flex(
    'ประวัติรายการ',
    bubble({
      header: header('ประวัติรายการ', page === 0 ? 'ล่าสุด' : `หน้า ${page + 1}`, mascotUrl('planning')),
      body: items.length
        ? [card(rows, { spacing: 'none' }), txt('แตะที่รายการเพื่อลบ', { size: 'xxs', color: BRAND.muted, align: 'center' })]
        : [txt('ยังไม่มีรายการเลย ลองพิมพ์ "กินข้าว 65" ดูสิ 🐔')],
      footer: nav.length ? [hbox(nav, { spacing: 'sm' })] : [],
    }),
  );
}

export function confirmDeleteMessage(t: Transaction, today: LocalDate): Message {
  const cat = getCategory(t.categoryId);
  return text(
    `ลบรายการนี้ใช่ไหม?\n${cat.emoji} ${t.note ?? cat.labelTh} ${signed(t.type, t.amountSatang)} (${dateLabel(t.txnDate, today)})${t.fixedCostOccurrenceId ? '\n\nรายการนี้คือการจ่ายบิล ถ้าลบ บิลจะกลับเป็น "ยังไม่จ่าย"' : ''}`,
    quickReply([
      pb('🗑️ ลบเลย', 'txn_delete_confirm', { id: t.id }, { displayText: 'ลบเลย' }),
      pb('ไม่ลบ', 'cancel_flow', {}, { displayText: 'ไม่ลบ' }),
    ]),
  );
}

export function deletedMessage(t: Transaction): Message {
  const cat = getCategory(t.categoryId);
  return text(
    `ลบ ${cat.emoji} ${t.note ?? cat.labelTh} ${formatBaht(t.amountSatang)} แล้ว`,
    quickReply([pb('↩️ เอากลับมา', 'txn_undo', { id: t.id }, { displayText: 'เอากลับมา' }), pb('ภาพรวม', 'dashboard')]),
  );
}

export interface MultiTotals {
  expenseSatang: Satang;
  incomeSatang: Satang;
}

function itemLines(items: Array<{ type: Transaction['type']; amountSatang: Satang; categoryId: string; note: string | null; txnDate: LocalDate; unsure?: boolean }>, today: LocalDate) {
  return items.map((d) => {
    const cat = getCategory(d.categoryId);
    return hbox(
      [
        txt(cat.emoji, { flex: 0, size: 'md' }),
        vbox([
          txt(d.note ?? cat.labelTh, { size: 'sm', weight: 'bold', wrap: false }),
          txt(`${cat.labelTh}${d.unsure ? ' · ไม่แน่ใจหมวด' : ''}${d.txnDate !== today ? ` · ${dateLabel(d.txnDate, today)}` : ''}`, { size: 'xxs', color: d.unsure ? BRAND.deepRed : BRAND.muted }),
        ], { flex: 6 }),
        txt(signed(d.type, d.amountSatang), { flex: 4, align: 'end', size: 'sm', weight: 'bold', color: amountColor(d.type), gravity: 'center' }),
      ],
      { spacing: 'md', paddingTop: '4px', paddingBottom: '4px' },
    );
  });
}

function totalsRows(t: MultiTotals) {
  return [
    ...(t.expenseSatang ? [row('รายจ่ายรวม', formatBaht(t.expenseSatang), { bold: true })] : []),
    ...(t.incomeSatang ? [row('รายรับรวม', `+${formatBaht(t.incomeSatang)}`, { bold: true, valueColor: BRAND.green })] : []),
  ];
}

/** One card for several items from one message; one tap saves them all (atomically). */
export function multiConfirmMessage(draftId: string, items: TransactionDraft[], today: LocalDate, totals: MultiTotals): FlexMessage {
  const anyUnsure = items.some((d) => !d.categoryConfident);
  return flex(
    `จด ${items.length} รายการนี้ใช่ไหม?`,
    bubble({
      header: header('ยืนยันหลายรายการ', `${items.length} รายการ`, mascotUrl('thinking')),
      body: [
        card([...itemLines(items.map((d) => ({ ...d, unsure: !d.categoryConfident })), today), sep({ margin: 'sm' }), ...totalsRows(totals)]),
        ...(anyUnsure ? [txt('รายการที่ไม่แน่ใจหมวดจะถูกจดเป็น "อื่นๆ" แก้หมวดทีหลังได้ในแอป', { size: 'xs', color: BRAND.muted })] : []),
      ],
      footer: [
        button(pb(`✅ บันทึกทั้ง ${items.length} รายการ`, 'multi_confirm', { id: draftId }, { displayText: 'บันทึกทั้งหมด' })),
        button(pb('ยกเลิก', 'draft_cancel', { id: draftId }, { displayText: 'ยกเลิก' }), 'link'),
      ],
    }),
  );
}

/** Shown after several items were saved (confirm tap or auto-record), with undo for the whole batch. */
export function multiSavedMessage(undoId: string | null, txns: Transaction[], today: LocalDate, totals: MultiTotals, comment: string, availableSatang: Satang): FlexMessage {
  return flex(
    `บันทึก ${txns.length} รายการแล้ว`,
    bubble({
      header: header('บันทึกแล้ว ✓', `${txns.length} รายการ`, mascotUrl('happy')),
      body: [
        txt(comment),
        card([...itemLines(txns, today), sep({ margin: 'sm' }), ...totalsRows(totals), row('ใช้ได้อีก (รอบนี้)', formatBaht(availableSatang), { bold: true, valueColor: availableSatang < 0 ? BRAND.red : BRAND.brown })]),
      ],
      footer: [
        hbox([
          button(pb('ดูภาพรวม', 'dashboard'), 'primary', { flex: 1 }),
          ...(undoId ? [button(pb('↩️ ยกเลิกทั้งหมด', 'multi_undo', { id: undoId }, { displayText: 'ยกเลิกทั้งหมด' }), 'secondary', { flex: 1 })] : []),
        ], { spacing: 'sm' }),
      ],
    }),
  );
}

export function autoRecordMessage(on: boolean): FlexMessage {
  return flex(
    on ? 'เปิดจดอัตโนมัติแล้ว' : 'ปิดจดอัตโนมัติแล้ว',
    bubble({
      size: 'kilo',
      header: header('จดอัตโนมัติ', on ? 'เปิดแล้ว' : 'ปิดแล้ว', mascotUrl(on ? 'smart' : 'thinking')),
      body: [
        txt(on
          ? 'ต่อไปรายการที่ชิกชิกมั่นใจ (มีจำนวนเงินและรู้หมวด) จะบันทึกทันทีโดยไม่ต้องกดยืนยัน มีปุ่มลบ/ยกเลิกให้ทุกครั้ง รายการที่ไม่แน่ใจยังถามก่อนเหมือนเดิม'
          : 'ต่อไปชิกชิกจะขึ้นการ์ดให้กดยืนยันก่อนบันทึกทุกครั้ง'),
      ],
      footer: [button(pb(on ? 'ปิดจดอัตโนมัติ' : 'เปิดจดอัตโนมัติ', 'auto_record_toggle', { on: on ? '0' : '1' }), 'secondary')],
    }),
  );
}
