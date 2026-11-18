/**
 * Plan catalogue: what each tier allows and costs. The single source of truth for limits —
 * the LINE bot, LIFF API and scheduler all read from here. `null` = unlimited.
 */
export type Plan = 'free' | 'plus' | 'pro';
export type PaidPlan = Exclude<Plan, 'free'>;
export const PLAN_RANK: Record<Plan, number> = { free: 0, plus: 1, pro: 2 };
export const TRIAL_DAYS = 14;

export interface PlanLimits {
  label: string;
  fixedCosts: number | null;
  goals: number | null;
  /** false → only the overall ("total") budget */
  categoryBudgets: boolean;
  docsPerMonth: number | null;
  /** AI understanding of loose sentences, per calendar month */
  aiPerMonth: number | null;
  /** fair-use cap per day (paid plans) */
  aiPerDay: number | null;
  /** daily/weekly summaries and bill reminders pushed by the bot (month-end summary is for everyone) */
  scheduledPush: boolean;
  /** how many periods the LIFF reports can show, current one included */
  historyPeriods: number | null;
}

export const PLANS: Record<Plan, PlanLimits> = {
  free: { label: 'ฟรี', fixedCosts: 3, goals: 1, categoryBudgets: false, docsPerMonth: 10, aiPerMonth: 20, aiPerDay: null, scheduledPush: false, historyPeriods: 2 },
  plus: { label: 'Plus', fixedCosts: null, goals: 5, categoryBudgets: true, docsPerMonth: 150, aiPerMonth: null, aiPerDay: 50, scheduledPush: true, historyPeriods: null },
  pro: { label: 'Pro', fixedCosts: null, goals: null, categoryBudgets: true, docsPerMonth: 500, aiPerMonth: null, aiPerDay: 100, scheduledPush: true, historyPeriods: null },
};

/** Prices in whole baht. */
export const PRICES = {
  plus: { monthly: 49, yearly: 399, earlyBirdYearly: 299 },
  pro: { monthly: 129, yearly: 1090 },
} as const;

export const PLAN_PITCH: Record<PaidPlan, string[]> = {
  plus: ['บิลประจำไม่จำกัด + เตือนก่อนครบกำหนด', 'สรุปรายวัน/รายสัปดาห์ส่งถึงแชท', 'งบทุกหมวด · เป้าออม 5 เป้า', 'อ่านสลิป/PDF 150 ครั้ง/เดือน', 'AI เข้าใจประโยคกำกวมไม่จำกัด'],
  pro: ['ทุกอย่างใน Plus', 'เป้าออมไม่จำกัด', 'อ่านสลิป/PDF 500 ครั้ง/เดือน', 'ได้ใช้ฟีเจอร์ใหม่ก่อนใคร: บัตรเครดิตหลายใบ ผู้ช่วยลดหย่อนภาษี กระเป๋าครอบครัว'],
};

export type LimitFeature = 'fixed_costs' | 'goals' | 'category_budget' | 'docs' | 'history';

/** The plan to suggest when `current` hits a limit. */
export function upgradeTarget(current: Plan): PaidPlan {
  return current === 'free' ? 'plus' : 'pro';
}
