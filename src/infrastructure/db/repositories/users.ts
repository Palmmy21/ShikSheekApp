import type { NotificationPrefs, OnboardingState, UserProfile } from '../../../domain/entities/index.ts';
import { toIso, type Sql } from '../sql.ts';

interface UserRow {
  line_user_id: string;
  display_name: string | null;
  cycle_start_day: number;
  notify_daily_summary: boolean;
  notify_weekly_summary: boolean;
  notify_monthly_summary: boolean;
  notify_bill_reminders: boolean;
  notify_budget_alerts: boolean;
  notify_streak: boolean;
  onboarding: OnboardingState;
  is_following: boolean;
  auto_record: boolean;
  created_at: unknown;
}

const COLUMNS = `line_user_id, display_name, cycle_start_day, notify_daily_summary, notify_weekly_summary,
  notify_monthly_summary, notify_bill_reminders, notify_budget_alerts, notify_streak, onboarding, is_following, auto_record, created_at`;

const PREF_COLUMNS: Record<keyof NotificationPrefs, string> = {
  dailySummary: 'notify_daily_summary',
  weeklySummary: 'notify_weekly_summary',
  monthlySummary: 'notify_monthly_summary',
  billReminders: 'notify_bill_reminders',
  budgetAlerts: 'notify_budget_alerts',
  streakReminders: 'notify_streak',
};

function map(r: UserRow): UserProfile {
  return {
    userId: r.line_user_id,
    displayName: r.display_name,
    cycleStartDay: Number(r.cycle_start_day),
    notifications: {
      dailySummary: r.notify_daily_summary,
      weeklySummary: r.notify_weekly_summary,
      monthlySummary: r.notify_monthly_summary,
      billReminders: r.notify_bill_reminders,
      budgetAlerts: r.notify_budget_alerts,
      streakReminders: r.notify_streak !== false,
    },
    onboarding: r.onboarding,
    isFollowing: r.is_following,
    autoRecord: r.auto_record === true,
    createdAt: toIso(r.created_at),
  };
}

export function userRepo(sql: Sql) {
  return {
    async get(userId: string): Promise<UserProfile | null> {
      const rows = await sql.query<UserRow>(`select ${COLUMNS} from users where line_user_id = $1`, [userId]);
      return rows[0] ? map(rows[0]) : null;
    },

    /** Create if missing; returns the profile and whether it was newly created. */
    async ensure(userId: string, displayName?: string | null): Promise<{ user: UserProfile; created: boolean }> {
      const inserted = await sql.query<UserRow>(
        `insert into users (line_user_id, display_name) values ($1, $2)
         on conflict (line_user_id) do nothing returning ${COLUMNS}`,
        [userId, displayName?.slice(0, 100) ?? null],
      );
      if (inserted[0]) return { user: map(inserted[0]), created: true };
      const existing = await this.get(userId);
      if (!existing) throw new Error('user vanished during ensure');
      return { user: existing, created: false };
    },

    async setFollowing(userId: string, following: boolean): Promise<void> {
      await sql.query('update users set is_following = $2 where line_user_id = $1', [userId, following]);
    },

    async setDisplayName(userId: string, displayName: string | null): Promise<void> {
      await sql.query('update users set display_name = $2 where line_user_id = $1', [userId, displayName?.slice(0, 100) ?? null]);
    },

    async setOnboarding(userId: string, state: OnboardingState): Promise<void> {
      await sql.query('update users set onboarding = $2 where line_user_id = $1', [userId, state]);
    },

    async setCycleStartDay(userId: string, day: number): Promise<void> {
      await sql.query('update users set cycle_start_day = $2 where line_user_id = $1', [userId, day]);
    },

    async toggleNotification(userId: string, key: keyof NotificationPrefs): Promise<boolean> {
      const col = PREF_COLUMNS[key];
      const rows = await sql.query<{ v: boolean }>(
        `update users set ${col} = not ${col} where line_user_id = $1 returning ${col} as v`,
        [userId],
      );
      return rows[0]?.v ?? false;
    },

    async setAutoRecord(userId: string, on: boolean): Promise<void> {
      await sql.query('update users set auto_record = $2 where line_user_id = $1', [userId, on]);
    },

    async setNotification(userId: string, key: keyof NotificationPrefs, value: boolean): Promise<void> {
      await sql.query(`update users set ${PREF_COLUMNS[key]} = $2 where line_user_id = $1`, [userId, value]);
    },

    /** Users eligible for a notification type (following + opted in). */
    async listNotifiable(key: keyof NotificationPrefs): Promise<UserProfile[]> {
      const rows = await sql.query<UserRow>(
        `select ${COLUMNS} from users where is_following and ${PREF_COLUMNS[key]} order by line_user_id`,
      );
      return rows.map(map);
    },

    async listAllFollowing(): Promise<UserProfile[]> {
      const rows = await sql.query<UserRow>(`select ${COLUMNS} from users where is_following order by line_user_id`);
      return rows.map(map);
    },

    /** Permanently delete the user and (via ON DELETE CASCADE) all of their data. */
    async deleteCompletely(userId: string): Promise<boolean> {
      const rows = await sql.query('delete from users where line_user_id = $1 returning 1', [userId]);
      return rows.length === 1;
    },
  };
}
export type UserRepo = ReturnType<typeof userRepo>;
