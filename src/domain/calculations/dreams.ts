/**
 * Life plan — "อนาคตที่อยากมี". A dream is a savings goal with a kind and a target date; ShikSheek
 * (the chicken) walks the road with the user: how much per month, which milestone ("ด่าน") is next,
 * whether they're on track, and a monthly coach note.
 *
 * Money maths on the ledger stays integer satang. The "if your money earned X%" lines are an
 * EDUCATIONAL illustration with assumed rates (floats rounded to satang) — never a product pick or a
 * promise, and never written to the ledger.
 */
import { addMonths, diffDays, parseLocalDate, type LocalDate } from '../dates.ts';
import type { DreamKind } from '../entities/index.ts';
import { formatBaht, ratioBasisPoints, type Satang } from '../money.ts';

export interface DreamTemplate {
  kind: DreamKind;
  label: string;
  emoji: string;
  mascot: string;
  /** suggestion only — the user always sets their own number */
  suggestedSatang: Satang;
  suggestedYears: number;
  /** what the money is for, shown under the picker */
  hint: string;
}

export const DREAM_TEMPLATES: readonly DreamTemplate[] = [
  { kind: 'home', label: 'บ้านหลังแรก', emoji: '🏠', mascot: 'planning', suggestedSatang: 30_000_000, suggestedYears: 5, hint: 'เงินดาวน์ + ค่าโอน ประมาณ 10–15% ของราคาบ้าน' },
  { kind: 'travel', label: 'เที่ยวต่างประเทศ', emoji: '✈️', mascot: 'excited', suggestedSatang: 8_000_000, suggestedYears: 1, hint: 'ตั๋ว ที่พัก กิน เที่ยว เผื่อเงินฉุกเฉินระหว่างทาง' },
  { kind: 'retire', label: 'เกษียณสบาย', emoji: '🌴', mascot: 'sleepy', suggestedSatang: 300_000_000, suggestedYears: 25, hint: 'ลองคิดจากค่าใช้จ่ายต่อเดือนหลังเกษียณ × 12 × จำนวนปี' },
  { kind: 'business', label: 'เปิดร้านของตัวเอง', emoji: '🏪', mascot: 'smart', suggestedSatang: 20_000_000, suggestedYears: 3, hint: 'ค่าตกแต่ง อุปกรณ์ สต็อกแรก + ค่าใช้จ่าย 6 เดือนแรก' },
  { kind: 'car', label: 'รถคันแรก', emoji: '🚗', mascot: 'happy', suggestedSatang: 15_000_000, suggestedYears: 2, hint: 'เงินดาวน์ ประกันปีแรก ค่าจดทะเบียน' },
  { kind: 'education', label: 'ทุนการศึกษา', emoji: '🎓', mascot: 'smart', suggestedSatang: 30_000_000, suggestedYears: 5, hint: 'ของตัวเองหรือของลูก ค่าเทอม + ค่าครองชีพ' },
  { kind: 'wedding', label: 'งานแต่งในฝัน', emoji: '💍', mascot: 'celebrating', suggestedSatang: 30_000_000, suggestedYears: 2, hint: 'สินสอด งานเลี้ยง ชุด ฮันนีมูน' },
  { kind: 'freedom', label: 'อิสรภาพทางการเงิน', emoji: '🦅', mascot: 'proud', suggestedSatang: 100_000_000, suggestedYears: 10, hint: 'เงินก้อนที่ทำให้เลือกชีวิตได้ ไม่ต้องรอเงินเดือน' },
  { kind: 'custom', label: 'ความฝันของฉัน', emoji: '⭐', mascot: 'encouraging', suggestedSatang: 5_000_000, suggestedYears: 1, hint: 'ตั้งชื่อเองได้เลย' },
];

export const DREAM_KINDS = DREAM_TEMPLATES.map((t) => t.kind) as [DreamKind, ...DreamKind[]];
export function dreamTemplate(kind: DreamKind): DreamTemplate {
  return DREAM_TEMPLATES.find((t) => t.kind === kind) ?? DREAM_TEMPLATES[DREAM_TEMPLATES.length - 1]!;
}

/** Milestones ("ด่าน") as % of the target. */
export const DREAM_MILESTONES = [10, 25, 50, 75, 100] as const;
/** Max dream horizon. */
export const DREAM_MAX_YEARS = 40;
/** Monthly amounts are rounded UP to a whole ฿10 so they read cleanly and never fall short. */
const ROUND_TO: Satang = 1_000;
/** "If your money earned X%" lines only for horizons long enough to ride out ups and downs. */
export const LONG_HORIZON_MONTHS = 36;
/** Assumed yearly returns for the illustration (basis points). Not a forecast. */
export const ILLUSTRATION_RATES_BP = [200, 500] as const;

export type DreamStatus = 'reached' | 'starting' | 'ahead' | 'on_track' | 'behind' | 'overdue';

export interface DreamPlan {
  targetSatang: Satang;
  savedSatang: Satang;
  remainingSatang: Satang;
  progressBasisPoints: number;
  /** months of saving left, counting the current one; 0 when the date has passed */
  monthsLeft: number;
  /** remaining ÷ months left, rounded up to ฿10 (0 when reached) */
  monthlyNeededSatang: Satang;
  /** straight-line "where you'd be by now" from start to target date */
  expectedByNowSatang: Satang;
  status: DreamStatus;
  /** highest milestone % passed (0 = none yet) */
  milestone: number;
  next: { percent: number; amountToGoSatang: Satang } | null;
}

const roundUp = (s: Satang) => Math.ceil(s / ROUND_TO) * ROUND_TO;

/** Whole monthly saving slots from `today` until `target` (≥1 while the date is ahead). */
export function monthsUntil(today: LocalDate, target: LocalDate): number {
  if (target <= today) return 0;
  const a = parseLocalDate(today);
  const b = parseLocalDate(target);
  let months = (b.year - a.year) * 12 + (b.month - a.month);
  if (b.day < a.day) months -= 1;
  return Math.max(1, months);
}

export function planDream(input: { targetSatang: Satang; savedSatang: Satang; today: LocalDate; startDate: LocalDate; targetDate: LocalDate }): DreamPlan {
  const { targetSatang: target, today } = input;
  const saved = Math.max(0, input.savedSatang);
  const remaining = Math.max(0, target - saved);
  const progress = Math.min(10_000, ratioBasisPoints(saved, target));
  const monthsLeft = monthsUntil(today, input.targetDate);
  const monthlyNeeded = remaining === 0 ? 0 : roundUp(Math.ceil(remaining / Math.max(1, monthsLeft)));

  const total = Math.max(1, diffDays(input.startDate, input.targetDate));
  const elapsed = Math.min(total, Math.max(0, diffDays(input.startDate, today)));
  const expected = Math.floor((target * elapsed) / total);

  let status: DreamStatus;
  if (remaining === 0) status = 'reached';
  else if (monthsLeft === 0) status = 'overdue';
  else if (elapsed < 31) status = 'starting';
  else if (saved * 10 >= expected * 11 && saved > 0) status = 'ahead';
  else if (saved * 10 >= expected * 9) status = 'on_track';
  else status = 'behind';

  const passed = DREAM_MILESTONES.filter((m) => progress >= m * 100);
  const milestone = passed.at(-1) ?? 0;
  const nextPct = DREAM_MILESTONES.find((m) => progress < m * 100);
  return {
    targetSatang: target,
    savedSatang: saved,
    remainingSatang: remaining,
    progressBasisPoints: progress,
    monthsLeft,
    monthlyNeededSatang: monthlyNeeded,
    expectedByNowSatang: expected,
    status,
    milestone,
    next: nextPct ? { percent: nextPct, amountToGoSatang: Math.max(0, Math.ceil((target * nextPct) / 100) - saved) } : null,
  };
}

/** Default target date for a template: today + suggested years. */
export function defaultTargetDate(today: LocalDate, years: number): LocalDate {
  return addMonths(today, Math.round(years * 12));
}

// ── education: compound growth (assumed rates, illustration only) ──

/** Balance after `months` of depositing `monthly` at an assumed yearly rate, compounded monthly. */
export function futureValue(startSatang: Satang, monthlySatang: Satang, annualRateBp: number, months: number): Satang {
  const r = annualRateBp / 10_000 / 12;
  let bal = startSatang;
  for (let i = 0; i < months; i++) bal = bal * (1 + r) + monthlySatang;
  return Math.round(bal);
}

/** Monthly deposit needed to reach `target` in `months` at an assumed rate (rounded up to ฿10). */
export function monthlyNeededAtRate(targetSatang: Satang, startSatang: Satang, months: number, annualRateBp: number): Satang {
  if (months <= 0) return Math.max(0, roundUp(targetSatang - startSatang));
  const r = annualRateBp / 10_000 / 12;
  const growth = (1 + r) ** months;
  const gap = targetSatang - startSatang * growth;
  if (gap <= 0) return 0;
  const pmt = r === 0 ? gap / months : (gap * r) / (growth - 1);
  return roundUp(Math.ceil(pmt));
}

export interface GrowthPoint {
  year: number;
  depositedSatang: Satang;
  balanceSatang: Satang;
}

/** Yearly points for the calculator chart: what you put in vs. what it could become. */
export function growthSeries(startSatang: Satang, monthlySatang: Satang, annualRateBp: number, years: number): GrowthPoint[] {
  const out: GrowthPoint[] = [];
  for (let y = 0; y <= years; y++) {
    out.push({ year: y, depositedSatang: startSatang + monthlySatang * 12 * y, balanceSatang: futureValue(startSatang, monthlySatang, annualRateBp, y * 12) });
  }
  return out;
}

export interface Illustration {
  rateBp: number;
  monthlySatang: Satang;
  /** how much less per month than saving with no return */
  savesPerMonthSatang: Satang;
}

/** For long horizons only: "at an assumed X% a year you'd need ฿Y a month instead". */
export function dreamIllustrations(plan: DreamPlan): Illustration[] {
  if (plan.status === 'reached' || plan.monthsLeft < LONG_HORIZON_MONTHS) return [];
  return ILLUSTRATION_RATES_BP.map((rateBp) => {
    const monthly = monthlyNeededAtRate(plan.targetSatang, plan.savedSatang, plan.monthsLeft, rateBp);
    return { rateBp, monthlySatang: monthly, savesPerMonthSatang: Math.max(0, plan.monthlyNeededSatang - monthly) };
  });
}

// ── companion (coach) copy ──

export interface CoachNote {
  mascot: string;
  headline: string;
  body: string;
}

export function coachNote(name: string, plan: DreamPlan, template: DreamTemplate): CoachNote {
  const per = formatBaht(plan.monthlyNeededSatang);
  const next = plan.next ? `อีก ${formatBaht(plan.next.amountToGoSatang)} ถึงด่าน ${plan.next.percent}%` : '';
  switch (plan.status) {
    case 'reached':
      return { mascot: 'celebrating', headline: `ถึงแล้ว! ${template.emoji} ${name}`, body: 'ความฝันที่ตั้งไว้ เก็บครบจริงๆ ชิกชิกภูมิใจมาก ไปใช้ให้คุ้มนะ แล้วมาตั้งฝันต่อไปกัน' };
    case 'overdue':
      return { mascot: 'thinking', headline: `${name} เลยวันที่ตั้งไว้แล้ว`, body: `ยังขาดอีก ${formatBaht(plan.remainingSatang)} ไม่เป็นไรเลย ขยับวันใหม่ให้สบายขึ้น แล้วเดินต่อด้วยกัน` };
    case 'starting':
      return { mascot: template.mascot, headline: `ออกเดินทางสู่ ${name} ${template.emoji}`, body: `เก็บเดือนละ ${per} อีก ${plan.monthsLeft} เดือนก็ถึง ชิกชิกจะคอยเช็กให้ทุกเดือนนะ` };
    case 'ahead':
      return { mascot: 'proud', headline: 'นำหน้าแผนไปแล้ว! 🚀', body: `เก่งมาก ตอนนี้เกินแผนแล้ว ${next ? `${next} ` : ''}เดือนละ ${per} ก็สบายๆ` };
    case 'on_track':
      return { mascot: 'happy', headline: 'ตามแผนเป๊ะ ✓', body: `เดินมาถูกทางแล้ว เดือนนี้เก็บ ${per} ${next ? `· ${next}` : ''}`.trim() };
    default:
      return { mascot: 'encouraging', headline: 'ช้ากว่าแผนนิดหน่อย ไม่เป็นไรนะ', body: `เดือนนี้เก็บให้ได้ ${per} ก็ยังไปถึงทันเวลา ค่อยๆ ไปด้วยกัน ชิกชิกอยู่ข้างๆ เสมอ 💪` };
  }
}
