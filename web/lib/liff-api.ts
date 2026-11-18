'use client';
/**
 * LIFF login + typed API client. The LIFF ID token is sent as a Bearer token; the backend verifies
 * it with LINE and scopes every query to that user. Nothing sensitive is stored in the browser.
 */
import liff from '@line/liff';

export const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '2012666543-0a8D84ww';
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://ozmannorrtzrvdxothtf.supabase.co/functions/v1/api').replace(/\/+$/, '');

export interface Money {
  satang: number;
  text: string;
}
export interface CategoryRef {
  id: string;
  label: string;
  emoji: string;
}
export interface Txn {
  id: string;
  type: 'income' | 'expense' | 'saving';
  amount: Money;
  category: CategoryRef;
  note: string | null;
  date: string;
  source: string;
  isBillPayment: boolean;
}
export interface Category extends CategoryRef {
  kind: 'income' | 'expense' | 'saving';
}
export interface BudgetItem {
  id: string;
  category: CategoryRef;
  limit: Money;
  spent: Money;
  remaining: Money;
  percent: number;
  level: 'ok' | 'warning' | 'exceeded';
}
export interface Dashboard {
  period: { key: string; start: string; end: string };
  available: Money;
  dailyAllowance: Money;
  daysRemaining: number;
  isNegative: boolean;
  hasIncome: boolean;
  income: Money;
  expense: Money;
  unpaidBills: Money;
  unpaidBillCount: number;
  savings: Money;
  today: Money;
  topCategories: Array<CategoryRef & { amount: Money }>;
  upcomingBills: Array<{ occurrenceId: string; name: string; dueDate: string; status: string; amount: Money }>;
  budgets: BudgetItem[];
}
export interface FixedCostItem {
  id: string;
  name: string;
  amount: Money;
  category: CategoryRef;
  schedule: string;
  status: 'active' | 'paused';
  remindDaysBefore: number;
  next: { occurrenceId: string | null; dueDate: string; status: string; amount: Money } | null;
  overdue: Array<{ occurrenceId: string; dueDate: string; amount: Money }>;
}
export interface GoalItem {
  id: string;
  name: string;
  target: Money;
  saved: Money;
  monthlyReserve: Money;
  progressPercent: number;
  isReached: boolean;
  periodsToGoal: number | null;
}
export interface MonthReport {
  period: { key: string; start: string; end: string; previousKey: string };
  income: Money;
  expense: Money;
  saving: Money;
  net: Money;
  expenseChange: Money | null;
  categories: Array<CategoryRef & { amount: Money; count: number }>;
  daily: Array<{ date: string; expense: Money }>;
  budgets: BudgetItem[];
}
export interface Me {
  displayName: string | null;
  cycleStartDay: number;
  autoRecord: boolean;
  notifications: Record<'dailySummary' | 'weeklySummary' | 'monthlySummary' | 'billReminders' | 'budgetAlerts', boolean>;
  today: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let ready: Promise<void> | null = null;

/** `?demo=1` renders the UI with sample data and never calls LINE or the API (design preview). */
export const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');

/** Initialise LIFF and make sure the user is logged in (redirects to LINE Login if needed). */
export function initLiff(): Promise<void> {
  if (DEMO) return Promise.resolve();
  ready ??= (async () => {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      await new Promise(() => {}); // page navigates away
    }
  })();
  return ready;
}

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

function relogin(): never {
  liff.logout();
  liff.login({ redirectUri: window.location.href });
  throw new ApiError(401, 'กำลังเข้าสู่ระบบใหม่…');
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (DEMO) {
    const { demoApi } = await import('./liff-demo');
    return demoApi<T>(path, init.method ?? 'GET');
  }
  await initLiff();
  const token = liff.getIDToken();
  if (!token || tokenExpired(token)) relogin();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 401) relogin();
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'เกิดข้อผิดพลาด');
  return data as T;
}

export function closeLiff(): void {
  if (liff.isInClient()) liff.closeWindow();
}

export const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thaiDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${THAI_MONTHS[m - 1]}${withYear ? ` ${String((y + 543) % 100).padStart(2, '0')}` : ''}`;
}
