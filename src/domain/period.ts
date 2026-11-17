/**
 * Budget periods ("รอบเดือน"). A period starts on `cycleStartDay` (1-28) and runs
 * until the day before the next start. Day 1 = calendar month.
 *
 * The period key is named after the month the period STARTS in:
 *   startDay=25, date 2026-11-24 -> key "2026-10" (2026-10-25 .. 2026-11-24)
 *
 * Start days are limited to 1..28 so every month has a valid start date.
 */
import { addDays, addMonths, diffDays, formatLocalDate, parseLocalDate, type LocalDate } from './dates.ts';

export type PeriodKey = string; // YYYY-MM

export interface Period {
  key: PeriodKey;
  start: LocalDate; // inclusive
  end: LocalDate; // inclusive
  cycleStartDay: number;
}

export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28;

export function assertCycleStartDay(day: number): void {
  if (!Number.isInteger(day) || day < MIN_CYCLE_START_DAY || day > MAX_CYCLE_START_DAY) {
    throw new RangeError(`cycleStartDay must be an integer 1-28, got ${day}`);
  }
}

export function periodFromKey(key: PeriodKey, cycleStartDay = 1): Period {
  assertCycleStartDay(cycleStartDay);
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`Invalid period key: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`Invalid period key: ${key}`);
  const start = formatLocalDate({ year, month, day: cycleStartDay });
  const end = addDays(addMonths(start, 1), -1);
  return { key, start, end, cycleStartDay };
}

export function periodForDate(date: LocalDate, cycleStartDay = 1): Period {
  assertCycleStartDay(cycleStartDay);
  const { year, month, day } = parseLocalDate(date);
  let y = year;
  let m = month;
  if (day < cycleStartDay) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return periodFromKey(`${y}-${String(m).padStart(2, '0')}`, cycleStartDay);
}

export function previousPeriod(period: Period): Period {
  return periodForDate(addDays(period.start, -1), period.cycleStartDay);
}

export function nextPeriod(period: Period): Period {
  return periodForDate(addDays(period.end, 1), period.cycleStartDay);
}

export function periodLengthDays(period: Period): number {
  return diffDays(period.start, period.end) + 1;
}

/** Days remaining including `today`. 0 if today is after the period. */
export function daysRemainingInclusive(period: Period, today: LocalDate): number {
  if (today > period.end) return 0;
  if (today < period.start) return periodLengthDays(period);
  return diffDays(today, period.end) + 1;
}

export function isDateInPeriod(date: LocalDate, period: Period): boolean {
  return date >= period.start && date <= period.end;
}
