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
  /** set when this goal is a life-plan dream (shown in its own section) */
  dream?: string | null;
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
  notifications: Record<'dailySummary' | 'weeklySummary' | 'monthlySummary' | 'billReminders' | 'budgetAlerts' | 'streakReminders', boolean>;
  today: string;
  plan?: { id: 'free' | 'plus' | 'pro'; label: string; source: 'free' | 'trial' | 'paid'; daysLeft: number | null };
}

export interface PlanInfo {
  plan: 'free' | 'plus' | 'pro';
  label: string;
  source: 'free' | 'trial' | 'paid';
  until: string | null;
  daysLeft: number | null;
  limits: { fixedCosts: number | null; goals: number | null; categoryBudgets: boolean; docsPerMonth: number | null; aiPerMonth: number | null; scheduledPush: boolean };
  usage: { docs: number; ai: number; fixedCosts: number; goals: number };
  prices: { plus: { monthly: number; yearly: number; earlyBirdYearly: number }; pro: { monthly: number; yearly: number } };
  pitch: { plus: string[]; pro: string[] };
  payable?: boolean;
  earlyBird?: boolean;
}

const PLAN_LIMIT_TEXT: Record<string, string> = {
  fixed_costs: 'แพ็กเกจของคุณตั้งบิลประจำครบแล้ว อัปเกรดเพื่อเพิ่มได้ไม่จำกัด',
  goals: 'แพ็กเกจของคุณตั้งเป้าออมครบแล้ว',
  category_budget: 'งบรายหมวดเป็นของ Plus แพ็กเกจฟรีตั้งได้เฉพาะงบรวม',
  history: 'แพ็กเกจฟรีดูรายงานย้อนหลังได้ 2 เดือน',
  docs: 'เดือนนี้อ่านสลิป/PDF ครบแล้ว',
};

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
    return demoApi<T>(path, init.method ?? 'GET', init.body);
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
  if (res.status === 402) throw new ApiError(402, PLAN_LIMIT_TEXT[(data as { feature?: string } | null)?.feature ?? ''] ?? 'ฟีเจอร์นี้สำหรับ Plus/Pro');
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

// ── story cards (shared to IG/FB stories) ──
export type StoryTheme = 'gold' | 'green' | 'red' | 'cream' | 'night';
export interface StoryValue {
  label: string;
  value: string;
  /** reveals money or a personal name → masked when "ซ่อนยอดเงิน" is on */
  private: boolean;
}
export interface StoryCard {
  kind: 'recap' | 'streak' | 'goal';
  theme: StoryTheme;
  mascot: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  hero: StoryValue;
  stats: StoryValue[];
  badge: string | null;
}
export interface StoryDeck {
  periodLabel: string;
  persona: { id: string; title: string; tagline: string; mascot: string; theme: StoryTheme };
  planBadge: 'PRO' | 'PLUS' | null;
  invite: { code: string; line: string };
  cards: StoryCard[];
  period: { start: string; end: string };
}

/** Running inside the LINE app (LIFF in-app browser). */
export function inLineClient(): boolean {
  return !DEMO && liff.isInClient();
}

/** Open a URL in the phone's normal browser (Web Share works there even when LINE's browser lacks it). */
export function openExternal(url: string): void {
  if (!DEMO && liff.isInClient()) liff.openWindow({ url, external: true });
  else window.open(url, '_blank', 'noopener');
}

// ── life plan (dreams) ──
export type DreamKind = 'home' | 'travel' | 'retire' | 'business' | 'car' | 'education' | 'wedding' | 'freedom' | 'custom';
export interface DreamTemplate {
  kind: DreamKind;
  label: string;
  emoji: string;
  mascot: string;
  suggested: Money;
  suggestedYears: number;
  hint: string;
}
export interface DreamItem {
  id: string;
  kind: DreamKind;
  name: string;
  emoji: string;
  mascot: string;
  target: Money;
  saved: Money;
  remaining: Money;
  targetDate: string;
  progressPercent: number;
  monthsLeft: number;
  monthlyNeeded: Money;
  status: 'reached' | 'starting' | 'ahead' | 'on_track' | 'behind' | 'overdue';
  milestone: number;
  next: { percent: number; amountToGo: Money } | null;
  coach: { mascot: string; headline: string; body: string };
  reserving: boolean;
  illustrations: Array<{ ratePercent: number; monthly: Money; savesPerMonth: Money }>;
}
export interface DreamsResponse {
  templates: DreamTemplate[];
  items: DreamItem[];
}

// ── statement report ──
export interface Statement {
  name: string | null;
  generatedOn: string;
  range: { start: string; end: string };
  days: number;
  income: Money;
  expense: Money;
  saving: Money;
  net: Money;
  keptPercent: number | null;
  months: Array<{ key: string; income: Money; expense: Money; saving: Money; net: Money }>;
  incomeByCategory: Array<{ id: string; label: string; amount: Money; count: number; percent: number }>;
  expenseByCategory: Array<{ id: string; label: string; amount: Money; count: number; percent: number }>;
  rows: Array<{ date: string; type: 'income' | 'expense' | 'saving'; category: string; note: string | null; amount: Money }>;
}

// ── investing basics calculator ──
export interface CompoundResult {
  deposited: Money;
  balance: Money;
  growth: Money;
  series: Array<{ year: number; deposited: Money; balance: Money }>;
}

/** Raw text response (e.g. CSV) with the same auth as `api()`. */
export async function apiText(path: string): Promise<string> {
  if (DEMO) return '﻿รายงานตัวอย่าง (โหมดสาธิต),\r\n';
  await initLiff();
  const token = liff.getIDToken();
  if (!token || tokenExpired(token)) relogin();
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) relogin();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'เกิดข้อผิดพลาด');
  }
  return res.text();
}
