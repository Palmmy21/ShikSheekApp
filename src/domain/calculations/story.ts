/**
 * Shareable story cards (9:16, for IG/FB/TikTok stories) — a mini "Wrapped" of the user's month.
 *
 * Pure and deterministic: the service gathers numbers, this file decides persona, copy and which
 * cards to show. The web app only draws what is returned here, so all wording is tested once.
 *
 * Privacy: values that reveal money or personal names are marked `private`; the share screen can
 * mask them before rendering. Income is never put on a card at all — only what was kept and rates.
 */
import { getCategory } from '../entities/categories.ts';
import { REFERRAL_REWARD_DAYS } from '../plans.ts';
import { formatBaht, ratioBasisPoints, type Satang } from '../money.ts';
import type { PeriodTotals } from './summary.ts';

export type StoryTheme = 'gold' | 'green' | 'red' | 'cream' | 'night';
export type StoryCardKind = 'recap' | 'streak' | 'goal';
export const STORY_CARD_KINDS: readonly StoryCardKind[] = ['recap', 'streak', 'goal'];

export type PersonaId = 'golden' | 'saver' | 'disciplined' | 'improver' | 'foodie' | 'shopper' | 'funlover' | 'brave' | 'steady' | 'rookie';

export interface Persona {
  id: PersonaId;
  title: string;
  tagline: string;
  mascot: string;
  theme: StoryTheme;
}

export interface StoryValue {
  label: string;
  value: string;
  /** reveals money or a personal name → maskable on the share screen */
  private: boolean;
}

export interface StoryCard {
  kind: StoryCardKind;
  theme: StoryTheme;
  mascot: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  hero: StoryValue;
  stats: StoryValue[];
  /** bragging line, e.g. "ออมเก่งกว่า 87% ของผู้ใช้ชิกชิก" */
  badge: string | null;
}

export interface StoryDeck {
  periodLabel: string;
  persona: Persona;
  /** paid plan shown on cards ("PRO"/"PLUS"); null for free & trial */
  planBadge: 'PRO' | 'PLUS' | null;
  invite: { code: string; line: string };
  cards: StoryCard[];
}

export interface StoryInput {
  displayName: string | null;
  periodStart: string;
  /** the period is still running (numbers are "so far") */
  inProgress: boolean;
  totals: PeriodTotals;
  /** expense of the previous period, null when it had no entries */
  previousExpenseSatang: Satang | null;
  streakDays: number;
  goals: ReadonlyArray<{ name: string; savedSatang: Satang; targetSatang: Satang; progressBasisPoints: number; isReached: boolean }>;
  /** % of comparable users this user out-saved (0–100), null when the cohort is too small */
  savingsPercentile: number | null;
  plan: 'free' | 'plus' | 'pro';
  planSource: 'free' | 'trial' | 'paid';
  referralCode: string;
}

/** Fewer entries than this → "rookie": not enough data to judge anyone. */
export const STORY_MIN_ENTRIES = 3;
export const STORY_MIN_STREAK = 3;
/** Don't publish percentiles from tiny cohorts (meaningless, and closer to individual data). */
export const PERCENTILE_MIN_COHORT = 20;
/** Only brag about the percentile when it is flattering. */
export const PERCENTILE_SHOW_FROM = 50;
export const LINE_OA_ID = '@541ywsff';

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2026-11-01' → 'พ.ย. 2569' (Buddhist year, as Thai users expect). */
export function thaiMonthYear(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return `${MONTHS_TH[m - 1]} ${y + 543}`;
}

/** Share of the cohort strictly below `mine`, floored to a whole percent; null if the cohort is too small. */
export function percentileBeaten(mine: number, cohort: readonly number[], minCohort = PERCENTILE_MIN_COHORT): number | null {
  if (cohort.length < minCohort) return null;
  const below = cohort.filter((v) => v < mine).length;
  return Math.floor((below * 100) / cohort.length);
}

/** Money kept this period = income − expense (saving transfers count as kept). Never negative. */
export function keptSatang(t: PeriodTotals): Satang {
  return Math.max(0, t.incomeSatang - t.expenseSatang);
}

/** Kept / income in basis points; null without income. */
export function savingsRateBp(t: PeriodTotals): number | null {
  return t.incomeSatang > 0 ? ratioBasisPoints(keptSatang(t), t.incomeSatang) : null;
}

const pct = (bp: number) => `${Math.floor(bp / 100)}%`;

export function choosePersona(input: Pick<StoryInput, 'totals' | 'previousExpenseSatang' | 'streakDays'>): Persona {
  const t = input.totals;
  if (t.transactionCount < STORY_MIN_ENTRIES) {
    return { id: 'rookie', title: 'ไก่น้อยหัดจด', tagline: 'เพิ่งเริ่มก็เท่แล้ว เดือนหน้าจัดเต็ม!', mascot: 'encouraging', theme: 'cream' };
  }
  const rate = savingsRateBp(t);
  if (rate !== null && rate >= 5_000) return { id: 'golden', title: 'ไก่ทองคำ', tagline: 'เก็บได้เกินครึ่งของรายรับ ระดับตำนาน', mascot: 'celebrating', theme: 'gold' };
  if (rate !== null && rate >= 2_000) return { id: 'saver', title: 'ไก่ออมเก่ง', tagline: 'มีเงินเหลือเก็บแบบสวยๆ', mascot: 'saving', theme: 'green' };
  if (input.streakDays >= 14) return { id: 'disciplined', title: 'ไก่วินัยเหล็ก', tagline: `จดติดกัน ${input.streakDays} วัน ไม่มีหลุด`, mascot: 'discipline', theme: 'night' };
  const prev = input.previousExpenseSatang;
  if (prev !== null && prev > 0 && t.expenseSatang * 10 <= prev * 9) {
    return { id: 'improver', title: 'ไก่สายพัฒนา', tagline: `ใช้น้อยลงกว่าเดือนก่อน ${pct(10_000 - ratioBasisPoints(t.expenseSatang, prev))}`, mascot: 'proud', theme: 'green' };
  }
  if (t.incomeSatang > 0 && t.expenseSatang > t.incomeSatang) {
    return { id: 'brave', title: 'ไก่ใจถึง', tagline: 'เดือนนี้จัดหนัก เดือนหน้าเอาคืน!', mascot: 'shocked', theme: 'red' };
  }
  const top = t.expenseByCategory[0];
  const share = top ? ratioBasisPoints(top.amountSatang, t.expenseSatang) : 0;
  if (top?.categoryId === 'food' && share >= 4_000) return { id: 'foodie', title: 'ไก่สายกิน', tagline: 'ความสุขอยู่ที่ปลายช้อน', mascot: 'happy', theme: 'red' };
  if (top?.categoryId === 'shopping' && share >= 3_000) return { id: 'shopper', title: 'ไก่นักช้อป', tagline: 'ตะกร้าไม่เคยว่าง แต่จดครบทุกบาท', mascot: 'excited', theme: 'red' };
  if (top?.categoryId === 'entertainment' && share >= 3_000) return { id: 'funlover', title: 'ไก่สายเอนจอย', tagline: 'ใช้ชีวิตให้คุ้ม แบบรู้ตัวเลข', mascot: 'excited', theme: 'night' };
  return { id: 'steady', title: 'ไก่สายชิล', tagline: 'รู้ทุกบาทที่จ่าย ใจเย็นๆ แต่ชัวร์', mascot: 'happy', theme: 'cream' };
}

function streakCopy(days: number): [string, string] {
  if (days >= 100) return ['ตำนานชิกชิก 👑', 'วินัยแบบนี้ เงินก็ต้องเหลือ'];
  if (days >= 30) return ['ครบเดือนไม่มีหลุด 🏆', 'นิสัยการเงินดีๆ เริ่มที่จดทุกวัน'];
  if (days >= 14) return ['ไฟลุกสองสัปดาห์ 🔥', 'คนส่วนใหญ่เลิกจดไปตั้งแต่วันที่ 3'];
  if (days >= 7) return ['ครบสัปดาห์แล้ว 🔥', 'เริ่มเป็นนิสัยแล้วนะ'];
  return ['ไฟเริ่มติดแล้ว 🔥', 'ทีละวัน เดี๋ยวก็เป็นนิสัย'];
}

export function buildStoryDeck(input: StoryInput): StoryDeck {
  const t = input.totals;
  const persona = choosePersona(input);
  const periodLabel = thaiMonthYear(input.periodStart);
  const who = input.displayName?.trim() ? input.displayName.trim().slice(0, 24) : null;
  const eyebrow = `${input.inProgress ? 'เดือนนี้ของ' : 'สรุปเดือนของ'}${who ? ` ${who}` : 'ฉัน'} · ${periodLabel}`;
  const rate = savingsRateBp(t);
  const showPercentile = input.savingsPercentile !== null && input.savingsPercentile >= PERCENTILE_SHOW_FROM && rate !== null;
  const badge = showPercentile ? `ออมเก่งกว่า ${input.savingsPercentile}% ของผู้ใช้ชิกชิก` : null;

  const stats: StoryValue[] = [];
  if (rate !== null) stats.push({ label: 'อัตราเก็บเงิน', value: pct(rate), private: false });
  stats.push({ label: 'จดไป', value: `${t.transactionCount} รายการ`, private: false });
  const top = t.expenseByCategory[0];
  if (top && t.expenseSatang > 0) {
    const c = getCategory(top.categoryId);
    stats.push({ label: 'หมวดโปรด', value: `${c.labelTh} ${pct(ratioBasisPoints(top.amountSatang, t.expenseSatang))}`, private: false });
  }
  if (input.streakDays >= 2) stats.push({ label: 'จดติดกัน', value: `${input.streakDays} วัน`, private: false });

  const kept = keptSatang(t);
  const cards: StoryCard[] = [{
    kind: 'recap',
    theme: persona.theme,
    mascot: persona.mascot,
    eyebrow,
    title: persona.title,
    subtitle: persona.tagline,
    hero: t.incomeSatang > 0
      ? { label: input.inProgress ? 'เก็บได้แล้ว' : 'เดือนนี้เก็บได้', value: formatBaht(kept), private: true }
      : { label: 'จดไปแล้ว', value: `${t.transactionCount} รายการ`, private: false },
    stats: stats.slice(0, 3),
    badge,
  }];

  if (input.streakDays >= STORY_MIN_STREAK) {
    const [title, subtitle] = streakCopy(input.streakDays);
    cards.push({
      kind: 'streak',
      theme: 'night',
      mascot: input.streakDays >= 30 ? 'celebrating' : 'discipline',
      eyebrow: `${who ?? 'ฉัน'} จดเงินกับชิกชิก`,
      title,
      subtitle,
      hero: { label: 'จดติดกัน', value: `${input.streakDays} วัน`, private: false },
      stats: [{ label: 'เดือนนี้จดไป', value: `${t.transactionCount} รายการ`, private: false }],
      badge: null,
    });
  }

  const goal = [...input.goals].filter((g) => g.progressBasisPoints >= 100).sort((a, b) => b.progressBasisPoints - a.progressBasisPoints)[0];
  if (goal) {
    cards.push({
      kind: 'goal',
      theme: goal.isReached ? 'gold' : 'green',
      mascot: goal.isReached ? 'celebrating' : 'planning',
      eyebrow: 'เป้าหมายเงินเก็บ',
      title: goal.isReached ? 'ถึงเป้าแล้ว! 🎉' : `ไปแล้ว ${pct(goal.progressBasisPoints)}`,
      subtitle: goal.isReached ? 'ฝันที่ตั้งไว้ เก็บครบจริงๆ' : 'ทีละนิด ใกล้เข้าไปทุกวัน',
      hero: { label: 'เป้าหมาย', value: goal.name.slice(0, 30), private: true },
      stats: [
        { label: 'เก็บแล้ว', value: formatBaht(goal.savedSatang), private: true },
        { label: 'ความคืบหน้า', value: pct(goal.progressBasisPoints), private: false },
      ],
      badge: null,
    });
  }

  return {
    periodLabel,
    persona,
    planBadge: input.planSource === 'paid' && input.plan !== 'free' ? (input.plan === 'pro' ? 'PRO' : 'PLUS') : null,
    invite: { code: input.referralCode, line: `ทักไลน์ ${LINE_OA_ID} ใส่โค้ด ${input.referralCode} รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วัน` },
    cards,
  };
}
