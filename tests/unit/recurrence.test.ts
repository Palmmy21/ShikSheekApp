import { describe, expect, it } from 'vitest';
import {
  deriveOccurrenceStatus,
  describeRuleThai,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  validateRule,
  type RecurrenceRule,
} from '../../src/domain/recurrence.ts';

const dates = (rule: RecurrenceRule, from: string, to: string) => occurrencesBetween(rule, from, to).map((o) => o.dueDate);

describe('monthly recurrence', () => {
  it('anchored on the 31st clamps without drifting', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-31' };
    expect(dates(rule, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
  });

  it('uses Feb 29 in leap years', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2027-12-30' };
    expect(dates(rule, '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-30']);
  });

  it('every 3 months', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 3, anchorDate: '2026-01-15' };
    expect(dates(rule, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
  });

  it('never yields dates before the anchor', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-06-10' };
    expect(dates(rule, '2026-01-01', '2026-07-31')).toEqual(['2026-06-10', '2026-07-10']);
  });

  it('respects end date', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-05', endDate: '2026-03-05' };
    expect(dates(rule, '2026-01-01', '2026-12-31')).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
  });

  it('is efficient and correct far from the anchor', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2000-01-31' };
    expect(dates(rule, '2030-02-01', '2030-02-28')).toEqual(['2030-02-28']);
  });

  it('gives one unique key per calendar month', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-31' };
    const keys = occurrencesBetween(rule, '2026-01-01', '2027-12-31').map((o) => o.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[1]).toBe('M2026-02');
  });

  it('keeps the same key when the due day is edited within the month (no duplicate bill)', () => {
    const before: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-05' };
    const after: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-20' };
    const k1 = occurrencesBetween(before, '2026-03-01', '2026-03-31')[0]!.occurrenceKey;
    const k2 = occurrencesBetween(after, '2026-03-01', '2026-03-31')[0]!.occurrenceKey;
    expect(k1).toBe(k2);
  });
});

describe('weekly, yearly and custom recurrence', () => {
  it('weekly every week', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', interval: 1, anchorDate: '2026-11-02' };
    expect(dates(rule, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });

  it('weekly every 2 weeks with ISO-week keys', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', interval: 2, anchorDate: '2026-11-04' };
    const occ = occurrencesBetween(rule, '2026-11-01', '2026-12-31');
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16', '2026-12-30']);
    expect(occ[0]!.occurrenceKey).toBe('W2026-11-02');
  });

  it('yearly on Feb 29 falls back to Feb 28 in non-leap years', () => {
    const rule: RecurrenceRule = { frequency: 'yearly', interval: 1, anchorDate: '2028-02-29' };
    expect(dates(rule, '2028-01-01', '2033-12-31')).toEqual([
      '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28',
    ]);
  });

  it('custom every 10 days', () => {
    const rule: RecurrenceRule = { frequency: 'custom', interval: 10, anchorDate: '2026-11-01' };
    expect(dates(rule, '2026-11-05', '2026-12-05')).toEqual(['2026-11-11', '2026-11-21', '2026-12-01']);
  });

  it('returns nothing for an inverted range', () => {
    const rule: RecurrenceRule = { frequency: 'custom', interval: 10, anchorDate: '2026-11-01' };
    expect(dates(rule, '2026-12-01', '2026-11-01')).toEqual([]);
  });
});

describe('next occurrence and validation', () => {
  it('finds the next occurrence on or after a date', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', interval: 1, anchorDate: '2026-01-25' };
    expect(nextOccurrenceOnOrAfter(rule, '2026-11-18')?.dueDate).toBe('2026-11-25');
    expect(nextOccurrenceOnOrAfter(rule, '2026-11-25')?.dueDate).toBe('2026-11-25');
    expect(nextOccurrenceOnOrAfter(rule, '2026-11-26')?.dueDate).toBe('2026-12-25');
    expect(nextOccurrenceOnOrAfter({ ...rule, endDate: '2026-11-25' }, '2026-11-26')).toBeNull();
  });

  it('rejects invalid rules', () => {
    expect(validateRule({ frequency: 'monthly', interval: 0, anchorDate: '2026-01-01' })).not.toEqual([]);
    expect(validateRule({ frequency: 'monthly', interval: 1, anchorDate: '2026-02-30' })).not.toEqual([]);
    expect(validateRule({ frequency: 'weekly', interval: 1, anchorDate: '2026-02-01', endDate: '2026-01-01' })).not.toEqual([]);
    expect(() => occurrencesBetween({ frequency: 'custom', interval: 1.5, anchorDate: '2026-01-01' }, '2026-01-01', '2026-02-01')).toThrow();
  });

  it('describes rules in Thai', () => {
    expect(describeRuleThai({ frequency: 'monthly', interval: 1, anchorDate: '2026-01-25' })).toBe('ทุกเดือน วันที่ 25');
    expect(describeRuleThai({ frequency: 'weekly', interval: 2, anchorDate: '2026-11-20' })).toBe('ทุก 2 สัปดาห์ วันศุกร์');
    expect(describeRuleThai({ frequency: 'yearly', interval: 1, anchorDate: '2026-03-10' })).toBe('ทุกปี วันที่ 10 มี.ค.');
    expect(describeRuleThai({ frequency: 'custom', interval: 14, anchorDate: '2026-03-10' })).toBe('ทุก 14 วัน');
  });
});

describe('occurrence display status', () => {
  it('derives upcoming / due / overdue from dates; paid and skipped are final', () => {
    expect(deriveOccurrenceStatus('pending', '2026-11-20', '2026-11-18')).toBe('upcoming');
    expect(deriveOccurrenceStatus('pending', '2026-11-18', '2026-11-18')).toBe('due');
    expect(deriveOccurrenceStatus('pending', '2026-11-10', '2026-11-18')).toBe('overdue');
    expect(deriveOccurrenceStatus('paid', '2026-11-10', '2026-11-18')).toBe('paid');
    expect(deriveOccurrenceStatus('skipped', '2026-11-30', '2026-11-18')).toBe('skipped');
  });
});
