/**
 * Recurrence rules for Fixed Costs (ค่าใช้จ่ายประจำ).
 *
 * Dates are always computed from the ANCHOR, never from the previous occurrence,
 * so month-end clamping does not drift: anchor Jan 31 -> Feb 28 -> Mar 31 -> Apr 30.
 *
 * Each occurrence has an `occurrenceKey` that is unique per fixed cost and stable
 * across edits to the due day, so regenerating never creates a second bill for
 * the same month/week/year. The database enforces UNIQUE(fixed_cost_id, occurrence_key).
 */
import {
  addDays,
  addMonths,
  diffDays,
  formatThaiShort,
  isoWeekday,
  parseLocalDate,
  startOfIsoWeek,
  type LocalDate,
} from './dates.ts';

export type Frequency = 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface RecurrenceRule {
  frequency: Frequency;
  /** weekly: every N weeks; monthly: every N months; yearly: every N years; custom: every N days */
  interval: number;
  anchorDate: LocalDate;
  endDate?: LocalDate | null;
}

export interface OccurrenceSlot {
  index: number;
  dueDate: LocalDate;
  occurrenceKey: string;
}

export const MAX_INTERVAL: Record<Frequency, number> = { weekly: 52, monthly: 24, yearly: 10, custom: 366 };

export function validateRule(rule: RecurrenceRule): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL[rule.frequency]) {
    errors.push(`interval must be 1-${MAX_INTERVAL[rule.frequency]} for ${rule.frequency}`);
  }
  try {
    parseLocalDate(rule.anchorDate);
  } catch {
    errors.push('anchorDate is not a valid date');
  }
  if (rule.endDate) {
    try {
      parseLocalDate(rule.endDate);
      if (rule.endDate < rule.anchorDate) errors.push('endDate is before anchorDate');
    } catch {
      errors.push('endDate is not a valid date');
    }
  }
  return errors;
}

function assertRule(rule: RecurrenceRule): void {
  const errors = validateRule(rule);
  if (errors.length) throw new RangeError(errors.join('; '));
}

/** Due date of the n-th occurrence (n >= 0). */
export function dueDateAt(rule: RecurrenceRule, n: number): LocalDate {
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.anchorDate, n * 7 * rule.interval);
    case 'custom':
      return addDays(rule.anchorDate, n * rule.interval);
    case 'monthly':
      return addMonths(rule.anchorDate, n * rule.interval);
    case 'yearly':
      return addMonths(rule.anchorDate, n * 12 * rule.interval);
  }
}

export function occurrenceKeyFor(rule: RecurrenceRule, dueDate: LocalDate): string {
  const { year, month } = parseLocalDate(dueDate);
  switch (rule.frequency) {
    case 'monthly':
      return `M${year}-${String(month).padStart(2, '0')}`;
    case 'yearly':
      return `Y${year}`;
    case 'weekly':
      return `W${startOfIsoWeek(dueDate)}`;
    case 'custom':
      return `D${dueDate}`;
  }
}

/** Smallest n whose due date could be >= `from` (may undershoot slightly; callers skip forward). */
function estimateStartIndex(rule: RecurrenceRule, from: LocalDate): number {
  if (from <= rule.anchorDate) return 0;
  const days = diffDays(rule.anchorDate, from);
  switch (rule.frequency) {
    case 'weekly':
      return Math.max(0, Math.floor(days / (7 * rule.interval)));
    case 'custom':
      return Math.max(0, Math.floor(days / rule.interval));
    case 'monthly': {
      const a = parseLocalDate(rule.anchorDate);
      const f = parseLocalDate(from);
      const months = (f.year - a.year) * 12 + (f.month - a.month);
      return Math.max(0, Math.floor(months / rule.interval) - 1);
    }
    case 'yearly': {
      const years = parseLocalDate(from).year - parseLocalDate(rule.anchorDate).year;
      return Math.max(0, Math.floor(years / rule.interval) - 1);
    }
  }
}

/**
 * All occurrences with from <= dueDate <= to (inclusive), respecting anchor and endDate.
 */
export function occurrencesBetween(rule: RecurrenceRule, from: LocalDate, to: LocalDate): OccurrenceSlot[] {
  assertRule(rule);
  if (to < from) return [];
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const result: OccurrenceSlot[] = [];
  let n = estimateStartIndex(rule, from);
  // Hard cap protects against runaway loops on bad input (e.g. a 50-year range of daily items).
  for (let guard = 0; guard < 5000; guard++, n++) {
    const due = dueDateAt(rule, n);
    if (due > last) break;
    if (due >= from) result.push({ index: n, dueDate: due, occurrenceKey: occurrenceKeyFor(rule, due) });
  }
  return result;
}

export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, date: LocalDate): OccurrenceSlot | null {
  assertRule(rule);
  let n = estimateStartIndex(rule, date);
  for (let guard = 0; guard < 5000; guard++, n++) {
    const due = dueDateAt(rule, n);
    if (rule.endDate && due > rule.endDate) return null;
    if (due >= date) return { index: n, dueDate: due, occurrenceKey: occurrenceKeyFor(rule, due) };
  }
  return null;
}

/** Stored state of an occurrence row. */
export type StoredOccurrenceStatus = 'pending' | 'paid' | 'skipped';
/** What the user sees. Derived from stored status + today, so no job has to flip statuses. */
export type OccurrenceDisplayStatus = 'upcoming' | 'due' | 'overdue' | 'paid' | 'skipped';

export function deriveOccurrenceStatus(
  stored: StoredOccurrenceStatus,
  dueDate: LocalDate,
  today: LocalDate,
): OccurrenceDisplayStatus {
  if (stored === 'paid' || stored === 'skipped') return stored;
  if (dueDate > today) return 'upcoming';
  if (dueDate === today) return 'due';
  return 'overdue';
}

export function describeRuleThai(rule: RecurrenceRule): string {
  const { day } = parseLocalDate(rule.anchorDate);
  const every = (unit: string) => (rule.interval === 1 ? `ทุก${unit}` : `ทุก ${rule.interval} ${unit}`);
  switch (rule.frequency) {
    case 'monthly':
      return `${every('เดือน')} วันที่ ${day}`;
    case 'weekly': {
      const names = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
      return `${every('สัปดาห์')} วัน${names[isoWeekday(rule.anchorDate) - 1]}`;
    }
    case 'yearly':
      return `${every('ปี')} วันที่ ${formatThaiShort(rule.anchorDate)}`;
    case 'custom':
      return `ทุก ${rule.interval} วัน`;
  }
}
