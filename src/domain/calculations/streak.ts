/**
 * Recording streaks: consecutive Bangkok calendar days with at least one entry recorded (by when it
 * was recorded, not the date it is for — back-filling yesterday today keeps today's streak only).
 */
import { addDays, type LocalDate } from '../dates.ts';

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365] as const;
/** Streak length that earns a one-time Plus bonus. */
export const STREAK_REWARD_AT = 30;
export const STREAK_REWARD_DAYS = 7;

export interface Streak {
  /** consecutive days ending today (or yesterday when nothing is recorded yet today) */
  days: number;
  recordedToday: boolean;
  /** streak ends tonight unless something is recorded today */
  atRisk: boolean;
  lastActive: LocalDate | null;
}

export function computeStreak(activeDays: readonly LocalDate[], today: LocalDate): Streak {
  const set = new Set(activeDays);
  const recordedToday = set.has(today);
  let cursor = recordedToday ? today : addDays(today, -1);
  let days = 0;
  while (set.has(cursor)) {
    days++;
    cursor = addDays(cursor, -1);
  }
  const lastActive = [...set].filter((d) => d <= today).sort().at(-1) ?? null;
  return { days, recordedToday, atRisk: !recordedToday && days > 0, lastActive };
}

/** The milestone just reached today, if any (only on the first entry of the day). */
export function milestoneReached(s: Streak, entriesToday: number): number | null {
  if (!s.recordedToday || entriesToday !== 1) return null;
  return (STREAK_MILESTONES as readonly number[]).includes(s.days) ? s.days : null;
}
