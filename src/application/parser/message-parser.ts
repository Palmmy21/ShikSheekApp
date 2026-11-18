/**
 * Message-level parser: commands, multi-item entries and extra questions, then the single-item
 * intent parser. Deterministic; nothing here saves anything.
 *
 * Multi-item rules:
 *  - items are split on new lines, commas, " และ " / " กับ "; otherwise each amount closes an item
 *    ("ข้าว 50 กาแฟ 40" → ["ข้าว 50", "กาแฟ 40"]);
 *  - one date phrase in the message applies to every item ("เมื่อวาน ข้าว 50 กาแฟ 40");
 *  - every piece must parse to a labelled transaction, otherwise the whole message is ambiguous.
 */
import type { LocalDate } from '../../domain/dates.ts';
import { CATEGORIES, getCategory, type Category } from '../../domain/entities/categories.ts';
import { TOTAL_BUDGET_CATEGORY } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { extractDate } from './dates.ts';
import { parseEdit, type EditIntent } from './edit-parser.ts';
import { matchCategory, parseIntent, type ParseResult, type TransactionProposal } from './intent-parser.ts';
import { extractAmounts, normalizeText, removeSpans } from './normalize.ts';

export const MAX_ITEMS_PER_MESSAGE = 15;

export type MessageParse =
  | ParseResult
  | EditIntent
  | { kind: 'multi'; items: TransactionProposal[] }
  | { kind: 'command'; command: 'delete_last' }
  | { kind: 'command'; command: 'edit_last'; amountSatang: Satang }
  | { kind: 'command'; command: 'set_budget'; categoryId: string; amountSatang: Satang }
  | { kind: 'command'; command: 'auto_record'; on: boolean }
  | { kind: 'command'; command: 'test_push' }
  | { kind: 'extra_query'; query: 'yesterday_spent' | 'last_month_summary' | 'today_list' }
  | { kind: 'extra_query'; query: 'category_spend'; categoryId: string };

/** Keyword match, then category label match ("ค่าเดินทาง" → transport). */
export function findCategory(text: string, kind?: Category['kind']): Category | null {
  const byKeyword = matchCategory(text, kind);
  if (byKeyword) return byKeyword.category;
  const byLabel = CATEGORIES.filter((c) => (!kind || c.kind === kind) && c.labelTh.split('/').some((l) => l.length >= 3 && text.includes(l.toLowerCase())));
  return byLabel.sort((a, b) => b.labelTh.length - a.labelTh.length)[0] ?? null;
}

const SINGLE_AMOUNT = (text: string): Satang | null => {
  const a = extractAmounts(text);
  return a.length === 1 && isValidPositiveAmount(a[0]!.satang) ? a[0]!.satang : null;
};

function parseCommand(text: string): MessageParse | null {
  if (/^(ลบ|ยกเลิก)\s*(รายการ|อัน)?\s*(ล่าสุด|เมื่อกี้|เมื่อกี๊|ที่แล้ว)$/.test(text)) return { kind: 'command', command: 'delete_last' };
  const edit = /^(แก้|เปลี่ยน)\s*(รายการ|อัน)?\s*(ล่าสุด|เมื่อกี้|เมื่อกี๊)\s*(เป็น)?\s*(.+)$/.exec(text);
  if (edit) {
    const amount = SINGLE_AMOUNT(edit[5]!);
    if (amount !== null) return { kind: 'command', command: 'edit_last', amountSatang: amount };
  }
  const budget = /^ตั้งงบ(ประมาณ)?\s*(.+)$/.exec(text);
  if (budget) {
    const rest = budget[2]!;
    const amount = SINGLE_AMOUNT(rest);
    if (amount !== null) {
      const label = removeSpans(rest, extractAmounts(rest)).replace(/เดือนละ|ต่อเดือน|ค่า/g, ' ').trim();
      const categoryId = /รวม|ทั้งหมด|ทั้งเดือน/.test(label) || !label ? TOTAL_BUDGET_CATEGORY : findCategory(label, 'expense')?.id;
      if (categoryId) return { kind: 'command', command: 'set_budget', categoryId, amountSatang: amount };
    }
  }
  if (/^(เปิด\s*(การ)?\s*จดอัตโนมัติ|จดเลยไม่ต้องถาม|ไม่ต้องยืนยัน|จดทันที)$/.test(text)) return { kind: 'command', command: 'auto_record', on: true };
  if (/^(ปิด\s*(การ)?\s*จดอัตโนมัติ|ถามก่อนจด|ยืนยันก่อนจด)$/.test(text)) return { kind: 'command', command: 'auto_record', on: false };
  if (/^(ทดสอบ\s*(การ)?\s*แจ้งเตือน|test\s*push|ทดสอบ\s*push)$/.test(text)) return { kind: 'command', command: 'test_push' };
  return null;
}

function parseExtraQuery(text: string): MessageParse | null {
  if (extractAmounts(text).length) return null;
  if (/เมื่อวาน.*(ใช้|จ่าย|หมด).*(เท่า(ไหร่|ไร)|กี่บาท)|^สรุปเมื่อวาน/.test(text)) return { kind: 'extra_query', query: 'yesterday_spent' };
  if (/เดือน(ที่แล้ว|ก่อน).*(ใช้|จ่าย|สรุป|เท่า)|สรุปเดือน(ที่แล้ว|ก่อน)/.test(text)) return { kind: 'extra_query', query: 'last_month_summary' };
  if (/^(รายการ)?วันนี้(จด|มี)?(อะไร)?(ไป)?(บ้าง)?$|วันนี้จดอะไร/.test(text) && !/(เท่า|กี่บาท)/.test(text)) return { kind: 'extra_query', query: 'today_list' };
  if (/(เท่า(ไหร่|ไร)|กี่บาท)/.test(text) && !/(เหลือ|ใช้ได้|คงเหลือ)/.test(text)) {
    const cat = findCategory(text.replace(/เดือนนี้|ใช้ไป|ไปแล้ว|ทั้งหมด/g, ' '));
    if (cat && cat.id !== 'savings') return { kind: 'extra_query', query: 'category_spend', categoryId: cat.id };
  }
  return null;
}

function splitByAmounts(text: string): string[] {
  const amounts = extractAmounts(text);
  if (amounts.length < 2) return [text];
  const pieces: string[] = [];
  let start = 0;
  amounts.forEach((a, i) => {
    const end = i === amounts.length - 1 ? text.length : a.end;
    pieces.push(text.slice(start, end).trim());
    start = end;
  });
  return pieces.filter(Boolean);
}

function splitItems(text: string): string[] | null {
  const byDelimiter = text.split(/\n|,|，|;|\s+และ\s+|\s+กับ\s+/).map((s) => s.trim()).filter(Boolean);
  const pieces = byDelimiter.flatMap(splitByAmounts).map((s) => s.trim()).filter(Boolean);
  return pieces.length >= 2 ? pieces : null;
}

export function parseMessage(input: string, today: LocalDate): MessageParse {
  // normalise line by line so newlines survive as item separators
  const text = input.split(/\r?\n/).map(normalizeText).filter(Boolean).join('\n');
  if (!text) return { kind: 'unknown' };

  const command = parseCommand(text);
  if (command) return command;
  const edit = text.includes('\n') ? null : parseEdit(text);
  if (edit) return edit;
  const extra = parseExtraQuery(text);
  if (extra) return extra;

  // multi-item (several lines/amounts)
  const multiline = text.includes('\n') || /,|，|;/.test(text);
  if (multiline || extractAmounts(text).length >= 2) {
    const date = extractDate(text, today);
    const body = date ? removeSpans(text, [date]) : text;
    const pieces = splitItems(body);
    if (pieces && pieces.length >= 2) {
      const items: TransactionProposal[] = [];
      for (const piece of pieces.slice(0, MAX_ITEMS_PER_MESSAGE + 1)) {
        const r = parseIntent(piece, today);
        if (r.kind !== 'transaction') return { kind: 'ambiguous', reason: 'multiple_amounts', amounts: extractAmounts(text).map((a) => a.satang) };
        items.push(date ? { ...r, txnDate: r.txnDate === today ? date.date : r.txnDate, dateIsFuture: r.dateIsFuture || date.future } : r);
      }
      if (items.length > MAX_ITEMS_PER_MESSAGE) return { kind: 'ambiguous', reason: 'multiple_amounts' };
      return { kind: 'multi', items };
    }
  }
  return parseIntent(input, today);
}

export { getCategory };
