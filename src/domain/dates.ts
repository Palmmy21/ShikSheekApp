/**
 * Calendar-date helpers working on plain "YYYY-MM-DD" strings (no time, no zone).
 * Financial records are dated by the user's local calendar day in Asia/Bangkok.
 * Thailand has no DST, so "today" is a fixed UTC+7 offset.
 */

export type LocalDate = string; // YYYY-MM-DD

export const BANGKOK_OFFSET_MINUTES = 7 * 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface YMD {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidLocalDate(value: string): value is LocalDate {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseLocalDate(value: LocalDate): YMD {
  if (!isValidLocalDate(value)) throw new RangeError(`Invalid date: ${value}`);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

export function formatLocalDate({ year, month, day }: YMD): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Build a date, clamping the day to the month length (Jan 31 + 1 month -> Feb 28/29). */
export function makeDateClamped(year: number, month: number, day: number): LocalDate {
  // normalise month overflow
  const zeroBased = month - 1;
  const y = year + Math.floor(zeroBased / 12);
  const m = (((zeroBased % 12) + 12) % 12) + 1;
  return formatLocalDate({ year: y, month: m, day: Math.min(day, daysInMonth(y, m)) });
}

/** Days since 1970-01-01 for a calendar date. */
export function toDayNumber(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  const d = new Date(n * DAY_MS);
  return formatLocalDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Add months keeping the day where possible, clamping at month end. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  return makeDateClamped(year, month + months, day);
}

export function diffDays(from: LocalDate, to: LocalDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  // ISO strings compare lexicographically.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** Monday=1 … Sunday=7 */
export function isoWeekday(date: LocalDate): number {
  const dow = new Date(toDayNumber(date) * DAY_MS).getUTCDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

/** The calendar date in Bangkok at the given instant. */
export function bangkokToday(now: Date = new Date()): LocalDate {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MINUTES * 60_000);
  return formatLocalDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** Hour of day (0-23) in Bangkok at the given instant. */
export function bangkokHour(now: Date = new Date()): number {
  return new Date(now.getTime() + BANGKOK_OFFSET_MINUTES * 60_000).getUTCHours();
}

/** Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_MONTHS_LONG = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_WEEKDAYS_SHORT = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/** "18 พ.ย." (optionally with Buddhist-era year "18 พ.ย. 69") */
export function formatThaiShort(date: LocalDate, withYear = false): string {
  const { year, month, day } = parseLocalDate(date);
  const base = `${day} ${THAI_MONTHS_SHORT[month - 1]}`;
  return withYear ? `${base} ${String((year + 543) % 100).padStart(2, '0')}` : base;
}

/** "พฤศจิกายน 2569" */
export function formatThaiMonthYear(year: number, month: number): string {
  return `${THAI_MONTHS_LONG[month - 1]} ${year + 543}`;
}

export function thaiWeekdayShort(date: LocalDate): string {
  return THAI_WEEKDAYS_SHORT[isoWeekday(date) - 1]!;
}
