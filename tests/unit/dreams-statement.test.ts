import { describe, expect, it } from 'vitest';
import {
  coachNote, dreamIllustrations, dreamTemplate, futureValue, growthSeries, monthlyNeededAtRate, monthsUntil, planDream, DREAM_TEMPLATES,
} from '../../src/domain/calculations/dreams.ts';
import { buildStatement, csvCell, statementToCsv, validateStatementRange } from '../../src/domain/calculations/statement.ts';
import { expense, income, saving } from '../helpers/fixtures.ts';

const plan = (p: Partial<Parameters<typeof planDream>[0]> = {}) =>
  planDream({ targetSatang: 12_000_000, savedSatang: 0, today: '2026-11-22', startDate: '2026-11-22', targetDate: '2027-11-22', ...p });

describe('dream maths', () => {
  it('counts whole monthly saving slots until the target date', () => {
    expect(monthsUntil('2026-11-22', '2027-11-22')).toBe(12);
    expect(monthsUntil('2026-11-22', '2027-11-21')).toBe(11);
    expect(monthsUntil('2026-11-22', '2026-12-01')).toBe(1); // less than a month still needs one deposit
    expect(monthsUntil('2026-11-22', '2026-11-22')).toBe(0);
    expect(monthsUntil('2026-11-22', '2026-01-01')).toBe(0);
  });

  it('monthly amount = remaining ÷ months, rounded UP to ฿10', () => {
    expect(plan().monthlyNeededSatang).toBe(1_000_000); // 120,000 / 12
    expect(plan({ targetSatang: 10_000_001 }).monthlyNeededSatang).toBe(834_000); // 833,333.34 → ฿8,340
    expect(plan({ savedSatang: 6_000_000 }).monthlyNeededSatang).toBe(500_000);
  });

  it('milestones and the next step', () => {
    const p = plan({ savedSatang: 3_100_000 }); // 25.8%
    expect(p.milestone).toBe(25);
    expect(p.next).toEqual({ percent: 50, amountToGoSatang: 2_900_000 });
    expect(plan().milestone).toBe(0);
    expect(plan().next?.percent).toBe(10);
  });

  it('status: starting → on track / ahead / behind (straight line from start), reached, overdue', () => {
    expect(plan().status).toBe('starting');
    const half = { startDate: '2026-05-22', targetDate: '2027-05-22' }; // ~half-way on 2026-11-22
    expect(plan({ ...half, savedSatang: 6_000_000 }).status).toBe('on_track');
    expect(plan({ ...half, savedSatang: 8_000_000 }).status).toBe('ahead');
    expect(plan({ ...half, savedSatang: 3_000_000 }).status).toBe('behind');
    expect(plan({ savedSatang: 12_000_000 })).toMatchObject({ status: 'reached', monthlyNeededSatang: 0, milestone: 100, next: null });
    expect(plan({ startDate: '2025-01-01', targetDate: '2026-10-01', savedSatang: 100 }).status).toBe('overdue');
  });

  it('coach notes are kind and actionable', () => {
    const t = dreamTemplate('travel');
    const behind = coachNote('ญี่ปุ่น', plan({ startDate: '2026-05-22', targetDate: '2027-05-22', savedSatang: 3_000_000 }), t);
    expect(behind.mascot).toBe('encouraging');
    expect(behind.body).toContain('฿15,000'); // remaining 90,000 over 6 months
    expect(coachNote('ญี่ปุ่น', plan({ savedSatang: 12_000_000 }), t).headline).toContain('ถึงแล้ว');
    expect(coachNote('ญี่ปุ่น', plan(), t).body).toContain('12 เดือน');
  });

  it('every template is valid and the fallback is "custom"', () => {
    for (const t of DREAM_TEMPLATES) expect(t.suggestedSatang).toBeGreaterThan(0);
    expect(dreamTemplate('nope' as never).kind).toBe('custom');
  });
});

describe('compound growth (education)', () => {
  it('0% is plain saving; a positive rate grows more than you put in', () => {
    expect(futureValue(0, 100_000, 0, 12)).toBe(1_200_000);
    expect(futureValue(0, 100_000, 600, 12)).toBe(1_233_556); // 6%/yr, monthly
    const s = growthSeries(0, 100_000, 500, 10);
    expect(s).toHaveLength(11);
    expect(s[10]!.depositedSatang).toBe(12_000_000);
    expect(s[10]!.balanceSatang).toBeGreaterThan(15_000_000);
  });

  it('needed monthly at an assumed rate is lower, and reaches the target', () => {
    const at5 = monthlyNeededAtRate(100_000_000, 0, 120, 500);
    expect(at5).toBeLessThan(monthlyNeededAtRate(100_000_000, 0, 120, 0));
    expect(futureValue(0, at5, 500, 120)).toBeGreaterThanOrEqual(100_000_000);
    expect(monthlyNeededAtRate(100, 1_000, 12, 500)).toBe(0);
  });

  it('illustrations only for long horizons (short-term money should stay safe)', () => {
    expect(dreamIllustrations(plan())).toEqual([]); // 12 months
    const long = dreamIllustrations(plan({ targetSatang: 300_000_000, targetDate: '2051-11-22' }));
    expect(long.map((i) => i.rateBp)).toEqual([200, 500]);
    expect(long[1]!.monthlySatang).toBeLessThan(long[0]!.monthlySatang);
    expect(long[1]!.savesPerMonthSatang).toBeGreaterThan(0);
  });
});

describe('statement report', () => {
  const txns = [
    income(3_000_000, '2026-10-01'),
    expense(500_000, '2026-10-05', { categoryId: 'food', note: 'ข้าว' }),
    expense(200_000, '2026-11-02', { categoryId: 'transport', note: '=HYPERLINK("http://x")' }),
    saving(100_000, '2026-11-03', 'g1'),
    expense(99_900, '2026-12-01'), // outside
    expense(1, '2026-11-04', { deletedAt: '2026-11-05T00:00:00Z' }), // deleted
  ];
  const st = buildStatement(txns, { start: '2026-10-01', end: '2026-11-30' });

  it('totals, months and categories', () => {
    expect(st).toMatchObject({ days: 61, incomeSatang: 3_000_000, expenseSatang: 700_000, savingSatang: 100_000, netSatang: 2_200_000, keptRateBp: 7_666 });
    expect(st.months.map((m) => [m.key, m.expenseSatang])).toEqual([['2026-10', 500_000], ['2026-11', 200_000]]);
    expect(st.expenseByCategory.map((c) => [c.label, c.shareBasisPoints])).toEqual([['อาหาร', 7_142], ['เดินทาง', 2_857]]);
    expect(st.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-05', '2026-11-02', '2026-11-03']);
  });

  it('partial months at both ends', () => {
    const s = buildStatement(txns, { start: '2026-10-04', end: '2026-11-02' });
    expect(s.months.map((m) => m.key)).toEqual(['2026-10', '2026-11']);
    expect(s.incomeSatang).toBe(0);
    expect(s.keptRateBp).toBeNull();
  });

  it('range validation', () => {
    expect(validateStatementRange('2026-01-01', '2026-12-31')).toBeNull();
    expect(validateStatementRange('2026-02-01', '2026-01-01')).toContain('ไม่อยู่หลัง');
    expect(validateStatementRange('2025-01-01', '2026-12-31')).toContain('366');
  });

  it('CSV opens in Excel (BOM, CRLF) and neutralises formulas', () => {
    const csv = statementToCsv(st, { name: 'ปาล์ม', generatedOn: '2026-11-22' });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('รายรับรวม,30000.00');
    expect(csv).toContain('2026-11,0.00,2000.00,1000.00,-3000.00');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csvCell('-5')).toBe('-5'); // plain numbers are safe
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell(-5)).toBe('-5'); // numbers are not text formulas
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});
