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

/** What can be bought. PromptPay is a one-off payment per period: no auto-renew, no stored cards. */
export const PRODUCTS = {
  plus_monthly: { plan: 'plus', days: 30, baht: PRICES.plus.monthly, label: 'Plus รายเดือน' },
  plus_yearly: { plan: 'plus', days: 365, baht: PRICES.plus.yearly, label: 'Plus รายปี' },
  plus_early: { plan: 'plus', days: 365, baht: PRICES.plus.earlyBirdYearly, label: 'Plus รายปี (ผู้ใช้กลุ่มแรก)' },
  pro_monthly: { plan: 'pro', days: 30, baht: PRICES.pro.monthly, label: 'Pro รายเดือน' },
  pro_yearly: { plan: 'pro', days: 365, baht: PRICES.pro.yearly, label: 'Pro รายปี' },
} as const satisfies Record<string, { plan: PaidPlan; days: number; baht: number; label: string }>;
export type ProductId = keyof typeof PRODUCTS;
export const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];
/** Early-bird price: first N purchases overall, once per user. */
export const EARLY_BIRD_LIMIT = 1000;

const DAY = 86_400_000;

/**
 * New subscription end after buying `productId`.
 * - nothing active → now + days
 * - same plan → extends from the current end
 * - switching plan → unused time is converted at the monthly-price ratio (fair both ways), then + days
 */
export function applyPurchase(current: { plan: PaidPlan; end: number } | null, productId: ProductId, now: number): { plan: PaidPlan; end: number } {
  const p = PRODUCTS[productId];
  const add = p.days * DAY;
  if (!current || current.end <= now) return { plan: p.plan, end: now + add };
  if (current.plan === p.plan) return { plan: p.plan, end: current.end + add };
  const remaining = current.end - now;
  const converted = Math.floor((remaining * PRICES[current.plan].monthly) / PRICES[p.plan].monthly);
  return { plan: p.plan, end: now + converted + add };
}

/** Referral reward: both the inviter and the invited friend get this many days of Plus. */
export const REFERRAL_REWARD_DAYS = 30;
/** Most rewarded invitations per inviter (12 × 30 days ≈ a year of Plus). */
export const REFERRAL_MAX_REWARDS = 12;
/** Entries the invited friend records before both rewards unlock (a real user, not a throwaway). */
export const REFERRAL_ACTIVATION_ENTRIES = 3;

/**
 * Add `days` of `plan` to the current subscription (bonus/referral/promo). Same rules as buying:
 * same plan → extend; different plan → convert the remaining time at the monthly-price ratio.
 */
export function applyGrant(current: { plan: PaidPlan; end: number } | null, plan: PaidPlan, days: number, now: number): { plan: PaidPlan; end: number } {
  const add = days * DAY;
  if (!current || current.end <= now) return { plan, end: now + add };
  if (current.plan === plan) return { plan, end: current.end + add };
  // keep the better plan, convert the granted days into it
  const keep = PLAN_RANK[current.plan] >= PLAN_RANK[plan] ? current.plan : plan;
  const remaining = current.end - now;
  const toKeep = (ms: number, from: PaidPlan) => (from === keep ? ms : Math.floor((ms * PRICES[from].monthly) / PRICES[keep].monthly));
  return { plan: keep, end: now + toKeep(remaining, current.plan) + toKeep(add, plan) };
}
