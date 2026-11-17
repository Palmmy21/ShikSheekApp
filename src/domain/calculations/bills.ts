/**
 * Selecting Fixed Cost occurrences for overviews and reminders.
 */
import { addDays, diffDays as daysBetween, type LocalDate } from '../dates.ts';
import type { FixedCost, FixedCostOccurrence } from '../entities/index.ts';
import { deriveOccurrenceStatus, type OccurrenceDisplayStatus } from '../recurrence.ts';

export interface OccurrenceView extends FixedCostOccurrence {
  displayStatus: OccurrenceDisplayStatus;
  daysUntilDue: number;
}


export function toOccurrenceView(o: FixedCostOccurrence, today: LocalDate): OccurrenceView {
  return { ...o, displayStatus: deriveOccurrenceStatus(o.status, o.dueDate, today), daysUntilDue: daysBetween(today, o.dueDate) };
}

/** Pending occurrences that are overdue or due within `withinDays` days (sorted by due date). */
export function upcomingBills(
  occurrences: readonly FixedCostOccurrence[],
  today: LocalDate,
  withinDays: number,
): OccurrenceView[] {
  const until = addDays(today, withinDays);
  return occurrences
    .filter((o) => o.status === 'pending' && o.dueDate <= until)
    .map((o) => toOccurrenceView(o, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

/**
 * Occurrences whose reminder should go out today: pending, and today is
 * `remindDaysBefore` days before due, or the due date itself, or overdue by exactly 1 day.
 * The scheduler records sends per occurrence, so repeated runs are safe.
 */
export function billsToRemind(
  occurrences: readonly FixedCostOccurrence[],
  fixedCosts: readonly FixedCost[],
  today: LocalDate,
): OccurrenceView[] {
  const costById = new Map(fixedCosts.map((f) => [f.id, f]));
  return occurrences
    .filter((o) => {
      if (o.status !== 'pending') return false;
      const cost = costById.get(o.fixedCostId);
      if (!cost || cost.status !== 'active') return false;
      const d = daysBetween(today, o.dueDate);
      return d === cost.remindDaysBefore || d === 0 || d === -1;
    })
    .map((o) => toOccurrenceView(o, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
