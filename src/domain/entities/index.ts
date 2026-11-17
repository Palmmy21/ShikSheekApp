/**
 * Domain entities. Pure data shapes shared by services, repositories and presenters.
 * Every entity that belongs to a user carries `userId` (the LINE user id).
 */
import type { LocalDate } from '../dates.ts';
import type { Satang } from '../money.ts';
import type { Frequency, StoredOccurrenceStatus } from '../recurrence.ts';

export type UserId = string;

export type TransactionType = 'income' | 'expense' | 'saving';
export type TransactionSource = 'chat' | 'rich_menu' | 'fixed_cost' | 'savings' | 'import';

export interface Transaction {
  id: string;
  userId: UserId;
  type: TransactionType;
  amountSatang: Satang;
  categoryId: string;
  note: string | null;
  txnDate: LocalDate;
  source: TransactionSource;
  fixedCostOccurrenceId: string | null;
  savingsGoalId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface NotificationPrefs {
  dailySummary: boolean;
  billReminders: boolean;
  budgetAlerts: boolean;
  monthlySummary: boolean;
  weeklySummary: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  dailySummary: true,
  billReminders: true,
  budgetAlerts: true,
  monthlySummary: true,
  weeklySummary: false,
};

export type OnboardingState = 'new' | 'asked_income' | 'asked_cycle' | 'done';

export interface UserProfile {
  userId: UserId;
  displayName: string | null;
  cycleStartDay: number;
  notifications: NotificationPrefs;
  onboarding: OnboardingState;
  isFollowing: boolean;
  createdAt: string;
}

export type FixedCostStatus = 'active' | 'paused';

export interface FixedCost {
  id: string;
  userId: UserId;
  name: string;
  amountSatang: Satang;
  categoryId: string;
  frequency: Frequency;
  interval: number;
  anchorDate: LocalDate;
  endDate: LocalDate | null;
  remindDaysBefore: number;
  status: FixedCostStatus;
}

export interface FixedCostOccurrence {
  id: string;
  userId: UserId;
  fixedCostId: string;
  occurrenceKey: string;
  dueDate: LocalDate;
  amountSatang: Satang;
  status: StoredOccurrenceStatus;
}

export interface Budget {
  id: string;
  userId: UserId;
  /** A category id, or TOTAL_BUDGET_CATEGORY for an overall spending cap. */
  categoryId: string;
  limitSatang: Satang;
}

export const TOTAL_BUDGET_CATEGORY = 'total';

export type SavingsGoalStatus = 'active' | 'completed' | 'archived';

export interface SavingsGoal {
  id: string;
  userId: UserId;
  name: string;
  targetSatang: Satang;
  /** Amount the user wants set aside each period; reduces available-to-spend until contributed. */
  monthlyReserveSatang: Satang;
  targetDate: LocalDate | null;
  status: SavingsGoalStatus;
}
