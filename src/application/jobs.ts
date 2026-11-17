/**
 * Scheduled automation. Invoked hourly (pg_cron → scheduler Edge Function).
 *
 * Each job has a target hour in Asia/Bangkok and a short catch-up window, so a missed hour is
 * retried on the next run but nobody gets a summary at 3 a.m. Every send is claimed in job_runs
 * per (job, run key, user) BEFORE pushing, and pushes carry a deterministic X-Line-Retry-Key, so
 * re-runs never double-send. A failed push releases its claim so the next run can retry.
 *
 * Reminders never create transactions.
 */
import { billsToRemind } from '../domain/calculations/bills.ts';
import { addDays, bangkokHour, bangkokToday, isoWeekday, type LocalDate } from '../domain/dates.ts';
import { periodForDate, previousPeriod } from '../domain/period.ts';
import type { NotificationPrefs, UserProfile } from '../domain/entities/index.ts';
import type { Message } from '../infrastructure/line/messages.ts';
import { redactUserId, type AppDeps, type HandlerContext } from '../presentation/line/context.ts';
import { upcomingBillsMessage } from '../presentation/line/flex/fixed-costs.ts';
import { showDaySummary, showMonthSummary, showWeekSummary } from '../presentation/line/handlers/views.ts';
import { GENERATION_HORIZON_DAYS } from './services/fixed-cost-service.ts';
import { sha256Hex } from './services/privacy-service.ts';

export type JobName = 'generate_occurrences' | 'bill_reminders' | 'daily_summary' | 'weekly_summary' | 'monthly_summary' | 'cleanup';

interface JobSpec {
  hour: number; // Bangkok
  windowHours: number; // run if hour <= now < hour + window
  weekday?: number; // ISO weekday filter
}

export const SCHEDULE: Record<JobName, JobSpec> = {
  generate_occurrences: { hour: 0, windowHours: 24 }, // any hour; idempotent anyway
  cleanup: { hour: 3, windowHours: 3 },
  bill_reminders: { hour: 8, windowHours: 4 },
  monthly_summary: { hour: 9, windowHours: 4 },
  weekly_summary: { hour: 20, windowHours: 3, weekday: 7 },
  daily_summary: { hour: 21, windowHours: 3 },
};

export function dueJobs(now: Date): JobName[] {
  const hour = bangkokHour(now);
  const today = bangkokToday(now);
  return (Object.keys(SCHEDULE) as JobName[]).filter((job) => {
    const s = SCHEDULE[job];
    if (s.weekday && isoWeekday(today) !== s.weekday) return false;
    return hour >= s.hour && hour < s.hour + s.windowHours;
  });
}

/** Deterministic UUID-shaped retry key for LINE push idempotency. */
export async function retryKeyFor(...parts: string[]): Promise<string> {
  const h = await sha256Hex(parts.join('|'));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface JobReport {
  job: JobName;
  sent: number;
  skipped: number;
  failed: number;
  detail?: string;
}

async function sendOnce(
  deps: AppDeps,
  job: JobName,
  runKey: string,
  userId: string,
  build: () => Promise<Message[] | null>,
  report: JobReport,
): Promise<void> {
  if (!(await deps.repos.jobRuns.claim(job, runKey, userId))) {
    report.skipped++;
    return;
  }
  try {
    const messages = await build();
    if (!messages || messages.length === 0) {
      report.skipped++;
      return;
    }
    await deps.line.push(userId, messages, await retryKeyFor(job, runKey, userId));
    report.sent++;
  } catch (err) {
    report.failed++;
    await deps.repos.jobRuns.release(job, runKey, userId).catch(() => {});
    deps.log.error('job_send_failed', { job, user: redactUserId(userId), error: err instanceof Error ? err.message : String(err) });
  }
}

function ctxFor(deps: AppDeps, user: UserProfile, now: Date, today: LocalDate): HandlerContext {
  return { userId: user.userId, now, today, deps };
}

async function usersFor(deps: AppDeps, pref: keyof NotificationPrefs): Promise<UserProfile[]> {
  return deps.repos.users.listNotifiable(pref);
}

export const jobs: Record<JobName, (deps: AppDeps, now: Date) => Promise<JobReport>> = {
  async generate_occurrences(deps, now) {
    const created = await deps.fixedCosts.generateForAllUsers(addDays(bangkokToday(now), GENERATION_HORIZON_DAYS));
    return { job: 'generate_occurrences', sent: 0, skipped: 0, failed: 0, detail: `created ${created}` };
  },

  async bill_reminders(deps, now) {
    const today = bangkokToday(now);
    const report: JobReport = { job: 'bill_reminders', sent: 0, skipped: 0, failed: 0 };
    await deps.fixedCosts.generateForAllUsers(addDays(today, GENERATION_HORIZON_DAYS));
    const candidates = await deps.repos.fixedCosts.listPendingDueBetweenAllUsers(addDays(today, -1), addDays(today, 14));
    const byUser = new Map<string, typeof candidates>();
    for (const o of candidates) byUser.set(o.userId, [...(byUser.get(o.userId) ?? []), o]);
    for (const [userId, occs] of byUser) {
      const costs = await deps.repos.fixedCosts.list(userId);
      const due = billsToRemind(occs, costs, today);
      if (due.length === 0) continue;
      const names = Object.fromEntries(costs.map((c) => [c.id, c.name]));
      await sendOnce(deps, 'bill_reminders', today, userId, async () => {
        const comment = await deps.personality.comment('bill_reminder', `${userId}:${today}`);
        const msg = upcomingBillsMessage(due, names, 'อย่าลืมจ่ายบิลน้า', 'เตือนบิล 🔔', 'discipline');
        return [msg, { type: 'text', text: comment }];
      }, report);
    }
    return report;
  },

  async daily_summary(deps, now) {
    const today = bangkokToday(now);
    const report: JobReport = { job: 'daily_summary', sent: 0, skipped: 0, failed: 0 };
    for (const user of await usersFor(deps, 'dailySummary')) {
      await sendOnce(deps, 'daily_summary', today, user.userId, () => showDaySummary(ctxFor(deps, user, now, today), today), report);
    }
    return report;
  },

  async weekly_summary(deps, now) {
    const today = bangkokToday(now);
    const report: JobReport = { job: 'weekly_summary', sent: 0, skipped: 0, failed: 0 };
    for (const user of await usersFor(deps, 'weeklySummary')) {
      await sendOnce(deps, 'weekly_summary', today, user.userId, () => showWeekSummary(ctxFor(deps, user, now, today)), report);
    }
    return report;
  },

  /** On the first day of each user's period, summarise the period that just ended. */
  async monthly_summary(deps, now) {
    const today = bangkokToday(now);
    const report: JobReport = { job: 'monthly_summary', sent: 0, skipped: 0, failed: 0 };
    for (const user of await usersFor(deps, 'monthlySummary')) {
      const period = periodForDate(today, user.cycleStartDay);
      if (period.start !== today) continue;
      const prev = previousPeriod(period);
      await sendOnce(deps, 'monthly_summary', prev.key, user.userId, () => showMonthSummary(ctxFor(deps, user, now, today), prev.key), report);
    }
    return report;
  },

  async cleanup(deps) {
    const purged = await deps.repos.webhookEvents.purgeOlderThan(7);
    await deps.repos.pending.purgeResolvedOlderThan(30);
    await deps.sql.query(`delete from data_export_tokens where expires_at < now() - interval '1 day'`);
    await deps.sql.query(`delete from job_runs where created_at < now() - interval '120 days'`);
    await deps.sql.query(`delete from conversation_states where expires_at < now()`);
    return { job: 'cleanup', sent: 0, skipped: 0, failed: 0, detail: `webhook events purged ${purged}` };
  },
};

/** Run all jobs due now (or the forced ones). Each job is isolated: one failing never blocks others. */
export async function runScheduledJobs(deps: AppDeps, now: Date, force?: JobName[]): Promise<JobReport[]> {
  const toRun = force && force.length ? force : dueJobs(now);
  const reports: JobReport[] = [];
  for (const job of toRun) {
    try {
      reports.push(await jobs[job](deps, now));
    } catch (err) {
      deps.log.error('job_failed', { job, error: err instanceof Error ? err.message : String(err) });
      reports.push({ job, sent: 0, skipped: 0, failed: 1, detail: 'job crashed' });
    }
  }
  return reports;
}
