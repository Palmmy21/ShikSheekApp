/**
 * Rule-based Thai intent parser. Deterministic and side-effect free.
 * Output is a structured proposal; nothing is saved until the user confirms.
 */
import { addDays, type LocalDate } from '../../domain/dates.ts';
import { CATEGORIES, defaultCategoryFor, type Category } from '../../domain/entities/categories.ts';
import type { TransactionType } from '../../domain/entities/index.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { extractDate } from './dates.ts';
import { extractAmounts, normalizeText, removeSpans } from './normalize.ts';

export type QueryIntent =
  | 'today_spent'
  | 'available'
  | 'upcoming_bills'
  | 'month_summary'
  | 'week_summary'
  | 'dashboard'
  | 'budgets'
  | 'fixed_costs'
  | 'goals'
  | 'history'
  | 'reports'
  | 'settings'
  | 'help'
  | 'cancel'
  | 'greeting'
  | 'thanks'
  | 'add_expense'
  | 'add_income'
  | 'export'
  | 'delete_data';

export interface TransactionProposal {
  kind: 'transaction';
  type: TransactionType;
  amountSatang: Satang;
  categoryId: string;
  /** false when no keyword matched; the confirmation card then asks the user to pick. */
  categoryConfident: boolean;
  note: string | null;
  txnDate: LocalDate;
  dateIsFuture: boolean;
}

export type ParseResult =
  | TransactionProposal
  | { kind: 'query'; intent: QueryIntent; date?: LocalDate; withinDays?: number }
  | { kind: 'amount_only'; amountSatang: Satang; txnDate: LocalDate }
  | { kind: 'ambiguous'; reason: 'multiple_amounts' | 'invalid_amount' | 'saving_needs_goal'; amounts?: Satang[] }
  | { kind: 'unknown' };

// Longest keywords first so "ข้าวมันไก่" beats "ข้าว" and "อาหารแมว" beats "อาหาร".
const KEYWORD_INDEX: Array<{ keyword: string; category: Category }> = CATEGORIES.flatMap((c) =>
  c.keywords.map((k) => ({ keyword: k.toLowerCase(), category: c })),
).sort((a, b) => b.keyword.length - a.keyword.length);

export function matchCategory(text: string, kind?: Category['kind']): { category: Category; keyword: string } | null {
  for (const entry of KEYWORD_INDEX) {
    if (kind && entry.category.kind !== kind) continue;
    if (text.includes(entry.keyword)) return { category: entry.category, keyword: entry.keyword };
  }
  return null;
}

const INCOME_HINT = /^(ได้|รับ)|ได้เงิน|ได้รับ|รายรับ|เงินเข้า|เงินออก(?=เดือน)|ขายได้|ถูกหวย|ถูกลอตเตอรี่/;
const SAVING_HINT = /^(ออม|เก็บเงิน|ฝากเงิน)/;

const QUERY_RULES: Array<{ re: RegExp; intent: QueryIntent; withinDays?: number; dateOffset?: number }> = [
  { re: /^(ยกเลิก|cancel|ไม่เอา(แล้ว)?|ช่างมัน)$/, intent: 'cancel' },
  { re: /พรุ่งนี้.*(ค่าอะไร|จ่ายอะไร|บิล|ต้องจ่าย)/, intent: 'upcoming_bills', withinDays: 1, dateOffset: 1 },
  { re: /(ค่าอะไร|บิลอะไร|ต้องจ่าย(อะไร)?บ้าง|บิลที่ต้องจ่าย|ใกล้ครบกำหนด|ครบกำหนด)/, intent: 'upcoming_bills', withinDays: 7 },
  { re: /วันนี้.*(ใช้|จ่าย|หมด).*(เท่า(ไหร่|ไร)|ไปเท่า|กี่บาท)|ใช้ไป(กี่บาท|เท่า(ไหร่|ไร))วันนี้|^สรุปวันนี้/, intent: 'today_spent' },
  { re: /(สัปดาห์|อาทิตย์)นี้.*(ใช้|จ่าย|สรุป)|สรุป(สัปดาห์|อาทิตย์)/, intent: 'week_summary' },
  { re: /เดือนนี้.*(ใช้|จ่าย).*(เท่า(ไหร่|ไร)|ไปเท่า|กี่บาท)|สรุป(ประจำ)?เดือน|รายงานเดือน/, intent: 'month_summary' },
  { re: /(เหลือ(เงิน)?|ใช้ได้(อีก)?|คงเหลือ).*(เท่า(ไหร่|ไร)|กี่บาท)|เงินเหลือ|ยอดคงเหลือ|เหลือใช้/, intent: 'available' },
  { re: /^(แดชบอร์ด|dashboard|ภาพรวม|ดูภาพรวม|หน้าหลัก|home)$/, intent: 'dashboard' },
  { re: /^(งบ|งบประมาณ|budget|budgets|ดูงบ)$/, intent: 'budgets' },
  { re: /^(ค่าใช้จ่ายประจำ|fixed ?costs?|บิล|บิลประจำ|รายจ่ายประจำ)$/, intent: 'fixed_costs' },
  { re: /^(เป้าหมาย|เป้าออม|ออมเงิน|เงินออม|goals?)$/, intent: 'goals' },
  { re: /^(ประวัติ|รายการ|รายการล่าสุด|history|ดูรายการ)$/, intent: 'history' },
  { re: /^(รายงาน|reports?|สรุป)$/, intent: 'reports' },
  { re: /^(ตั้งค่า|settings?|การแจ้งเตือน)$/, intent: 'settings' },
  { re: /^(ช่วย(ด้วย)?|help|วิธีใช้|ใช้ยังไง|ทำอะไรได้บ้าง|เมนู|menu|\?)$/, intent: 'help' },
  { re: /^(จดรายจ่าย|เพิ่มรายจ่าย|รายจ่าย)$/, intent: 'add_expense' },
  { re: /^(จดรายรับ|เพิ่มรายรับ|รายรับ)$/, intent: 'add_income' },
  { re: /^(ส่งออกข้อมูล|export|ขอข้อมูล)$/, intent: 'export' },
  { re: /^(ลบข้อมูล(ทั้งหมด)?|delete my data)$/, intent: 'delete_data' },
  { re: /^(สวัสดี|หวัดดี|ดีจ้า|ดีครับ|ดีค่ะ|hello|hi|hey)/, intent: 'greeting' },
  { re: /^(ขอบคุณ|ขอบใจ|thx|thanks?|thank you|เยี่ยม|เก่งมาก)/, intent: 'thanks' },
];

export function parseIntent(input: string, today: LocalDate): ParseResult {
  const text = normalizeText(input);
  if (!text) return { kind: 'unknown' };

  const amounts = extractAmounts(text);

  if (amounts.length === 0) {
    for (const rule of QUERY_RULES) {
      if (rule.re.test(text)) {
        const result: ParseResult = { kind: 'query', intent: rule.intent };
        if (rule.withinDays !== undefined) result.withinDays = rule.withinDays;
        if (rule.dateOffset !== undefined) result.date = addDays(today, rule.dateOffset);
        return result;
      }
    }
    return { kind: 'unknown' };
  }

  if (amounts.length > 1) return { kind: 'ambiguous', reason: 'multiple_amounts', amounts: amounts.map((a) => a.satang) };

  const amount = amounts[0]!;
  if (!isValidPositiveAmount(amount.satang)) return { kind: 'ambiguous', reason: 'invalid_amount', amounts: [amount.satang] };

  const dateMatch = extractDate(text, today);
  const spans: Array<{ start: number; end: number }> = [amount];
  if (dateMatch) spans.push(dateMatch);
  const rest = removeSpans(text, spans)
    .replace(/(^|\s)(ไป|จ่าย|ซื้อ|ค่า)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const txnDate = dateMatch?.date ?? today;

  if (!rest) return { kind: 'amount_only', amountSatang: amount.satang, txnDate };

  if (SAVING_HINT.test(rest)) return { kind: 'ambiguous', reason: 'saving_needs_goal', amounts: [amount.satang] };

  const incomeMatch = matchCategory(rest, 'income');
  const expenseMatch = matchCategory(rest, 'expense');
  const looksIncome = INCOME_HINT.test(rest);

  let type: TransactionType;
  let match: ReturnType<typeof matchCategory>;
  if (incomeMatch && (!expenseMatch || incomeMatch.keyword.length >= expenseMatch.keyword.length || looksIncome)) {
    type = 'income';
    match = incomeMatch;
  } else if (looksIncome && !expenseMatch) {
    type = 'income';
    match = null;
  } else {
    type = 'expense';
    match = expenseMatch;
  }

  const note = rest.slice(0, 100) || null;
  return {
    kind: 'transaction',
    type,
    amountSatang: amount.satang,
    categoryId: match?.category.id ?? defaultCategoryFor(type === 'income' ? 'income' : 'expense'),
    categoryConfident: match !== null,
    note,
    txnDate,
    dateIsFuture: dateMatch?.future ?? false,
  };
}
