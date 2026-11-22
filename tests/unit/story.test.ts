import { describe, expect, it } from 'vitest';
import {
  buildStoryDeck, choosePersona, keptSatang, percentileBeaten, savingsRateBp, thaiMonthYear,
  PERCENTILE_MIN_COHORT, type StoryInput,
} from '../../src/domain/calculations/story.ts';
import { summarizeTransactions } from '../../src/domain/calculations/summary.ts';
import { expense, income, saving } from '../helpers/fixtures.ts';

const RANGE = { start: '2026-11-01', end: '2026-11-30' };
const totalsOf = (...txns: Parameters<typeof summarizeTransactions>[0]) => summarizeTransactions(txns, RANGE);

function input(partial: Partial<StoryInput> = {}): StoryInput {
  return {
    displayName: 'ปาล์ม',
    periodStart: '2026-11-01',
    inProgress: false,
    totals: totalsOf(income(3_000_000, '2026-11-01'), expense(1_000_000, '2026-11-02'), expense(500_000, '2026-11-03')),
    previousExpenseSatang: null,
    streakDays: 0,
    goals: [],
    savingsPercentile: null,
    plan: 'free',
    planSource: 'free',
    referralCode: 'AB3XYZ',
    ...partial,
  };
}

describe('story helpers', () => {
  it('formats the month in Thai with the Buddhist year', () => {
    expect(thaiMonthYear('2026-11-01')).toBe('พ.ย. 2569');
    expect(thaiMonthYear('2027-01-25')).toBe('ม.ค. 2570');
  });

  it('kept money and savings rate count saving transfers as kept, never go negative', () => {
    const t = totalsOf(income(1_000_000, '2026-11-01'), expense(400_000, '2026-11-02'), saving(200_000, '2026-11-03', 'g1'));
    expect(keptSatang(t)).toBe(600_000);
    expect(savingsRateBp(t)).toBe(6_000);
    const over = totalsOf(income(100_000, '2026-11-01'), expense(300_000, '2026-11-02'));
    expect(keptSatang(over)).toBe(0);
    expect(savingsRateBp(over)).toBe(0);
    expect(savingsRateBp(totalsOf(expense(100, '2026-11-02')))).toBeNull();
  });

  it('percentile counts users strictly below, and hides small cohorts', () => {
    const cohort = Array.from({ length: 20 }, (_, i) => i * 500); // 0, 500, …, 9500
    expect(percentileBeaten(5_000, cohort)).toBe(50); // 10 of 20 below
    expect(percentileBeaten(0, cohort)).toBe(0);
    expect(percentileBeaten(99_999, cohort)).toBe(100);
    expect(percentileBeaten(5_000, cohort.slice(0, PERCENTILE_MIN_COHORT - 1))).toBeNull();
  });
});

describe('persona', () => {
  const persona = (p: Partial<StoryInput>) => choosePersona(input(p)).id;

  it('rookie until there are enough entries', () => {
    expect(persona({ totals: totalsOf(income(100_000, '2026-11-01'), expense(10_000, '2026-11-02')) })).toBe('rookie');
  });

  it('ranks savers by savings rate first', () => {
    // kept 15,000 of 30,000 → 50%
    expect(persona({})).toBe('golden');
    // kept 6,000 of 30,000 → 20%
    expect(persona({ totals: totalsOf(income(3_000_000, '2026-11-01'), expense(2_000_000, '2026-11-02'), expense(400_000, '2026-11-03')) })).toBe('saver');
  });

  it('then streak discipline, then improvement over last month', () => {
    const spendy = totalsOf(income(3_000_000, '2026-11-01'), expense(2_000_000, '2026-11-02', { categoryId: 'bills' }), expense(900_000, '2026-11-03', { categoryId: 'transport' }));
    expect(persona({ totals: spendy, streakDays: 14 })).toBe('disciplined');
    expect(persona({ totals: spendy, previousExpenseSatang: 3_300_000 })).toBe('improver'); // 2.9M ≤ 90% of 3.3M
    expect(choosePersona(input({ totals: spendy, previousExpenseSatang: 3_300_000 })).tagline).toContain('12%');
    expect(persona({ totals: spendy, previousExpenseSatang: 3_000_000 })).toBe('steady'); // only 3% less
  });

  it('overspending, then spending-style personas', () => {
    expect(persona({ totals: totalsOf(income(100_000, '2026-11-01'), expense(90_000, '2026-11-02'), expense(90_000, '2026-11-03')) })).toBe('brave');
    const style = (categoryId: string) =>
      persona({ totals: totalsOf(income(1_000_000, '2026-11-01'), expense(500_000, '2026-11-02', { categoryId }), expense(350_000, '2026-11-03', { categoryId: 'bills' })) });
    expect(style('food')).toBe('foodie');
    expect(style('shopping')).toBe('shopper');
    expect(style('entertainment')).toBe('funlover');
    expect(style('transport')).toBe('steady');
  });
});

describe('buildStoryDeck', () => {
  it('recap card: kept money is private, income never appears anywhere', () => {
    const deck = buildStoryDeck(input());
    expect(deck.cards.map((c) => c.kind)).toEqual(['recap']);
    const recap = deck.cards[0]!;
    expect(recap.eyebrow).toBe('สรุปเดือนของ ปาล์ม · พ.ย. 2569');
    expect(recap.title).toBe('ไก่ทองคำ');
    expect(recap.hero).toEqual({ label: 'เดือนนี้เก็บได้', value: '฿15,000', private: true });
    expect(recap.stats).toContainEqual({ label: 'อัตราเก็บเงิน', value: '50%', private: false });
    expect(recap.stats).toContainEqual({ label: 'หมวดโปรด', value: 'อาหาร 100%', private: false });
    expect(JSON.stringify(deck)).not.toContain('30,000'); // income
    expect(deck.invite).toEqual({ code: 'AB3XYZ', line: 'ทักไลน์ @541ywsff ใส่โค้ด AB3XYZ รับ Plus ฟรี 30 วัน' });
  });

  it('in-progress months say "so far"; no income → count entries instead of money', () => {
    const deck = buildStoryDeck(input({ inProgress: true, displayName: null, totals: totalsOf(expense(100, '2026-11-01'), expense(100, '2026-11-02'), expense(100, '2026-11-03')) }));
    const recap = deck.cards[0]!;
    expect(recap.eyebrow).toBe('เดือนนี้ของฉัน · พ.ย. 2569');
    expect(recap.hero).toEqual({ label: 'จดไปแล้ว', value: '3 รายการ', private: false });
    expect(recap.stats.find((s) => s.label === 'อัตราเก็บเงิน')).toBeUndefined();
  });

  it('only brags about the percentile when it is flattering', () => {
    expect(buildStoryDeck(input({ savingsPercentile: 87 })).cards[0]!.badge).toBe('ออมเก่งกว่า 87% ของผู้ใช้ชิกชิก');
    expect(buildStoryDeck(input({ savingsPercentile: 49 })).cards[0]!.badge).toBeNull();
    expect(buildStoryDeck(input({ savingsPercentile: null })).cards[0]!.badge).toBeNull();
  });

  it('adds a streak card from 3 days and a goal card for the best goal in progress', () => {
    const deck = buildStoryDeck(input({
      streakDays: 30,
      goals: [
        { name: 'เที่ยวญี่ปุ่น', savedSatang: 2_000_000, targetSatang: 5_000_000, progressBasisPoints: 4_000, isReached: false },
        { name: 'มือถือใหม่', savedSatang: 100, targetSatang: 4_000_000, progressBasisPoints: 0, isReached: false },
      ],
    }));
    expect(deck.cards.map((c) => c.kind)).toEqual(['recap', 'streak', 'goal']);
    const streak = deck.cards[1]!;
    expect(streak.hero.value).toBe('30 วัน');
    expect(streak.title).toBe('ครบเดือนไม่มีหลุด 🏆');
    const goal = deck.cards[2]!;
    expect(goal.title).toBe('ไปแล้ว 40%');
    expect(goal.hero).toEqual({ label: 'เป้าหมาย', value: 'เที่ยวญี่ปุ่น', private: true });
    expect(goal.stats[0]).toEqual({ label: 'เก็บแล้ว', value: '฿20,000', private: true });

    expect(buildStoryDeck(input({ streakDays: 2 })).cards.map((c) => c.kind)).toEqual(['recap']);
    const reached = buildStoryDeck(input({ goals: [{ name: 'ทุนฉุกเฉิน', savedSatang: 1, targetSatang: 1, progressBasisPoints: 10_000, isReached: true }] }));
    expect(reached.cards[1]).toMatchObject({ kind: 'goal', theme: 'gold', title: 'ถึงเป้าแล้ว! 🎉' });
  });

  it('plan badge only for paid plans (status you bought, not a trial)', () => {
    expect(buildStoryDeck(input({ plan: 'pro', planSource: 'paid' })).planBadge).toBe('PRO');
    expect(buildStoryDeck(input({ plan: 'plus', planSource: 'paid' })).planBadge).toBe('PLUS');
    expect(buildStoryDeck(input({ plan: 'pro', planSource: 'trial' })).planBadge).toBeNull();
    expect(buildStoryDeck(input()).planBadge).toBeNull();
  });

  it('long names are trimmed so they fit the card', () => {
    const deck = buildStoryDeck(input({ displayName: 'ก'.repeat(60) }));
    expect(deck.cards[0]!.eyebrow).toBe(`สรุปเดือนของ ${'ก'.repeat(24)} · พ.ย. 2569`);
  });
});

describe('LINE story message', () => {
  it('links to the LIFF story studio and passes Flex validation; falls back without LIFF', async () => {
    const { configureLiffUrl } = await import('../../src/presentation/line/links.ts');
    (await import('../../src/presentation/line/mascot.ts')).configureAssetBaseUrl('https://a.example.com/a');
    const { storyMessage } = await import('../../src/presentation/line/flex/engagement.ts');
    const { validateMessages } = await import('../helpers/flex-validator.ts');
    configureLiffUrl('https://liff.line.me/123-abc');
    const msg = storyMessage();
    expect(validateMessages([msg])).toEqual([]);
    expect(JSON.stringify(msg)).toContain('https://liff.line.me/123-abc?tab=story');
    configureLiffUrl(null);
    const fallback = storyMessage();
    expect(validateMessages([fallback])).toEqual([]);
    expect(JSON.stringify(fallback)).not.toContain('tab=story');
  });
});
