/**
 * Parsers for setting up Fixed Costs and Savings Goals from one line of Thai text.
 *   "ค่าเน็ต 599 ทุกวันที่ 5"     "ค่าห้อง 6500 ทุกเดือน"     "ยิม 300 ทุกวันจันทร์"
 *   "ประกันรถ 18000 ทุกปี 10/3"   "ค่าน้ำดื่ม 60 ทุก 10 วัน"   "netflix 419 ทุก 2 เดือน"
 *   "เที่ยวญี่ปุ่น 30000 เดือนละ 3000"
 */
import { addDays, isoWeekday, makeDateClamped, parseLocalDate, type LocalDate } from '../../domain/dates.ts';
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { nextOccurrenceOnOrAfter, validateRule, type Frequency, type RecurrenceRule } from '../../domain/recurrence.ts';
import { extractDate } from './dates.ts';
import { matchCategory } from './intent-parser.ts';
import { extractAmounts, normalizeText, removeSpans } from './normalize.ts';

export interface FixedCostProposal {
  name: string;
  amountSatang: Satang;
  categoryId: string;
  rule: RecurrenceRule;
  firstDueDate: LocalDate;
}

export type SetupParseError = 'no_amount' | 'multiple_amounts' | 'no_name' | 'no_schedule' | 'invalid';

const WEEKDAYS: Array<[RegExp, number]> = [
  [/จันทร์|จ\./, 1], [/อังคาร/, 2], [/พุธ/, 3], [/พฤหัส(บดี)?/, 4], [/ศุกร์/, 5], [/เสาร์/, 6], [/อาทิตย์/, 7],
];

function nextWeekday(today: LocalDate, isoDow: number): LocalDate {
  const diff = (isoDow - isoWeekday(today) + 7) % 7;
  return addDays(today, diff);
}

interface ScheduleMatch {
  frequency: Frequency;
  interval: number;
  anchor: LocalDate;
  start: number;
  end: number;
}

function extractSchedule(text: string, today: LocalDate): ScheduleMatch | null {
  const t = parseLocalDate(today);
  let m: RegExpExecArray | null;

  // ทุก N วัน / ทุก N สัปดาห์ / ทุก N เดือน / ทุก N ปี
  if ((m = /ทุก\s*(\d{1,3})\s*(วัน|สัปดาห์|อาทิตย์|เดือน|ปี)/.exec(text))) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const frequency: Frequency = unit === 'วัน' ? 'custom' : unit === 'เดือน' ? 'monthly' : unit === 'ปี' ? 'yearly' : 'weekly';
    return { frequency, interval: n, anchor: today, start: m.index, end: m.index + m[0].length };
  }
  // ทุกวันที่ N / วันที่ N ของทุกเดือน / ทุกเดือนวันที่ N
  if ((m = /(?:ทุก(?:เดือน)?\s*วันที่|วันที่)\s*(\d{1,2})(?:\s*ของ)?(?:\s*ทุกเดือน)?/.exec(text))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    return { frequency: 'monthly', interval: 1, anchor: makeDateClamped(t.year, t.month, day), start: m.index, end: m.index + m[0].length };
  }
  // ทุกวันจันทร์ / ทุกสัปดาห์ (วันศุกร์)
  for (const [re, dow] of WEEKDAYS) {
    const wm = new RegExp(`ทุก\\s*(?:สัปดาห์|อาทิตย์)?\\s*(?:วัน)?(?:${re.source})`).exec(text);
    if (wm) return { frequency: 'weekly', interval: 1, anchor: nextWeekday(today, dow), start: wm.index, end: wm.index + wm[0].length };
  }
  if ((m = /ทุก(สัปดาห์|อาทิตย์)/.exec(text))) {
    return { frequency: 'weekly', interval: 1, anchor: today, start: m.index, end: m.index + m[0].length };
  }
  if ((m = /ทุกเดือน|รายเดือน|เดือนละครั้ง/.exec(text))) {
    return { frequency: 'monthly', interval: 1, anchor: today, start: m.index, end: m.index + m[0].length };
  }
  if ((m = /ทุกปี|รายปี|ปีละครั้ง/.exec(text))) {
    // optional explicit date ("ทุกปี 10/3")
    const rest = text.slice(m.index + m[0].length);
    const d = extractDate(rest, `${t.year}-12-31`);
    const anchor = d ? d.date : today;
    const end = d ? m.index + m[0].length + d.end : m.index + m[0].length;
    return { frequency: 'yearly', interval: 1, anchor, start: m.index, end };
  }
  return null;
}

export function parseFixedCost(
  input: string,
  today: LocalDate,
): { ok: true; value: FixedCostProposal } | { ok: false; error: SetupParseError } {
  const text = normalizeText(input);
  const schedule = extractSchedule(text, today);
  if (!schedule) return { ok: false, error: 'no_schedule' };
  const withoutSchedule = removeSpans(text, [schedule]);
  const amounts = extractAmounts(withoutSchedule);
  if (amounts.length === 0) return { ok: false, error: 'no_amount' };
  if (amounts.length > 1) return { ok: false, error: 'multiple_amounts' };
  const amount = amounts[0]!;
  if (!isValidPositiveAmount(amount.satang)) return { ok: false, error: 'invalid' };
  const name = removeSpans(withoutSchedule, [amount]).replace(/^(จ่าย|ค่า\s+)/, '').trim();
  if (!name) return { ok: false, error: 'no_name' };

  const rule: RecurrenceRule = { frequency: schedule.frequency, interval: schedule.interval, anchorDate: schedule.anchor };
  if (validateRule(rule).length) return { ok: false, error: 'invalid' };
  // Bills already due earlier this month are assumed handled before the user joined: start from today.
  const first = nextOccurrenceOnOrAfter(rule, today);
  if (!first) return { ok: false, error: 'invalid' };
  return {
    ok: true,
    value: {
      name: name.slice(0, 60),
      amountSatang: amount.satang,
      categoryId: matchCategory(name, 'expense')?.category.id ?? 'bills',
      rule: { ...rule, anchorDate: first.dueDate },
      firstDueDate: first.dueDate,
    },
  };
}

export interface GoalProposal {
  name: string;
  targetSatang: Satang;
  monthlyReserveSatang: Satang;
}

export function parseGoal(input: string): { ok: true; value: GoalProposal } | { ok: false; error: SetupParseError } {
  const text = normalizeText(input);
  let monthly = 0;
  let working = text;
  const mm = /(เดือนละ|ต่อเดือน|ทุกเดือน)\s*/.exec(working);
  if (mm) {
    const after = working.slice(mm.index + mm[0].length);
    const a = extractAmounts(after)[0];
    if (a) {
      monthly = a.satang;
      working = working.slice(0, mm.index) + ' ' + after.slice(0, a.start) + ' ' + after.slice(a.end);
    } else {
      working = working.slice(0, mm.index) + ' ' + after;
    }
  }
  const amounts = extractAmounts(working);
  if (amounts.length === 0) return { ok: false, error: 'no_amount' };
  if (amounts.length > 1) return { ok: false, error: 'multiple_amounts' };
  const target = amounts[0]!;
  if (!isValidPositiveAmount(target.satang) || monthly < 0) return { ok: false, error: 'invalid' };
  const name = removeSpans(working, [target]).replace(/^(เก็บเงิน|ออมเงิน|เป้า(หมาย)?)\s*/, '').trim();
  if (!name) return { ok: false, error: 'no_name' };
  return { ok: true, value: { name: name.slice(0, 60), targetSatang: target.satang, monthlyReserveSatang: monthly } };
}

/** A bare amount reply ("5000", "5,000 บาท", "5k"). */
export function parseBareAmount(input: string): Satang | null {
  const text = normalizeText(input);
  const amounts = extractAmounts(text);
  if (amounts.length !== 1) return null;
  const rest = removeSpans(text, amounts);
  if (rest.length > 0) return null;
  return isValidPositiveAmount(amounts[0]!.satang) ? amounts[0]!.satang : null;
}
