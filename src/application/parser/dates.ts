/**
 * Relative / explicit date phrases in Thai chat text.
 */
import { addDays, isValidLocalDate, parseLocalDate, formatLocalDate, type LocalDate } from '../../domain/dates.ts';

export interface DateMatch {
  date: LocalDate;
  start: number;
  end: number;
  /** true when the phrase points to the future (e.g. พรุ่งนี้) */
  future: boolean;
}

const THAI_MONTH_ABBR: Array<[RegExp, number]> = [
  [/^ม\.?ค\.?/, 1], [/^ก\.?พ\.?/, 2], [/^มี\.?ค\.?/, 3], [/^เม\.?ย\.?/, 4], [/^พ\.?ค\.?/, 5], [/^มิ\.?ย\.?/, 6],
  [/^ก\.?ค\.?/, 7], [/^ส\.?ค\.?/, 8], [/^ก\.?ย\.?/, 9], [/^ต\.?ค\.?/, 10], [/^พ\.?ย\.?/, 11], [/^ธ\.?ค\.?/, 12],
];

function normalizeYear(y: number): number {
  if (y > 2400) return y - 543; // Buddhist era, 4 digits (2569)
  // 2 digits: Thai users usually write the short Buddhist year ("69" = 2569 = 2026).
  if (y < 100) return y >= 40 ? 2500 + y - 543 : 2000 + y;
  return y;
}

/** Most recent date with this day/month on or before `today` (for past expenses without a year). */
function resolveDayMonth(day: number, month: number, today: LocalDate, year?: number): LocalDate | null {
  const t = parseLocalDate(today);
  const y = year ?? t.year;
  let candidate = formatLocalDate({ year: y, month, day });
  if (!isValidLocalDate(candidate)) return null;
  if (year === undefined && candidate > today) {
    candidate = formatLocalDate({ year: y - 1, month, day });
    if (!isValidLocalDate(candidate)) return null;
  }
  return candidate;
}

export function extractDate(text: string, today: LocalDate): DateMatch | null {
  const rules: Array<{ re: RegExp; resolve: (m: RegExpExecArray) => { date: LocalDate | null; future: boolean } }> = [
    { re: /เมื่อวานซืน/, resolve: () => ({ date: addDays(today, -2), future: false }) },
    { re: /เมื่อวาน(นี้)?/, resolve: () => ({ date: addDays(today, -1), future: false }) },
    { re: /มะรืน(นี้)?/, resolve: () => ({ date: addDays(today, 2), future: true }) },
    { re: /พรุ่งนี้/, resolve: () => ({ date: addDays(today, 1), future: true }) },
    { re: /วันนี้/, resolve: () => ({ date: today, future: false }) },
    {
      re: /(?:เมื่อ\s*)?(\d{1,2})\s*วัน(?:ที่แล้ว|ก่อน)/,
      resolve: (m) => ({ date: addDays(today, -Number(m[1])), future: false }),
    },
    {
      re: /(?<![\d,.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d,.])/,
      resolve: (m) => ({
        date: resolveDayMonth(Number(m[1]), Number(m[2]), today, m[3] ? normalizeYear(Number(m[3])) : undefined),
        future: false,
      }),
    },
    {
      re: /(?:วันที่\s*)?(\d{1,2})\s*(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?)/,
      resolve: (m) => {
        const month = THAI_MONTH_ABBR.find(([re]) => re.test(m[2]!))?.[1];
        return { date: month ? resolveDayMonth(Number(m[1]), month, today) : null, future: false };
      },
    },
  ];
  for (const { re, resolve } of rules) {
    const m = re.exec(text);
    if (!m) continue;
    const { date, future } = resolve(m);
    if (!date) continue;
    return { date, start: m.index, end: m.index + m[0].length, future: future || date > today };
  }
  return null;
}
