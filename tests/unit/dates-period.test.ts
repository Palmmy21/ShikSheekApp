import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  bangkokHour,
  bangkokToday,
  daysInMonth,
  diffDays,
  formatThaiMonthYear,
  formatThaiShort,
  isLeapYear,
  isValidLocalDate,
  isoWeekday,
  startOfIsoWeek,
} from '../../src/domain/dates.ts';
import {
  daysRemainingInclusive,
  nextPeriod,
  periodForDate,
  periodFromKey,
  periodLengthDays,
  previousPeriod,
} from '../../src/domain/period.ts';

describe('calendar basics', () => {
  it('knows leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('validates dates', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
  });

  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-01', '2026-11-30')).toBe(29);
  });

  it('adds months with month-end clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('weekday helpers use Monday=1', () => {
    expect(isoWeekday('2026-11-18')).toBe(3); // Wednesday
    expect(isoWeekday('2026-11-22')).toBe(7); // Sunday
    expect(startOfIsoWeek('2026-11-22')).toBe('2026-11-16');
  });
});

describe('Bangkok time', () => {
  it('rolls over to the next day at 17:00 UTC', () => {
    expect(bangkokToday(new Date('2026-11-18T16:59:59Z'))).toBe('2026-11-18');
    expect(bangkokToday(new Date('2026-11-18T17:00:00Z'))).toBe('2026-11-19');
    expect(bangkokToday(new Date('2026-12-31T17:30:00Z'))).toBe('2027-01-01');
    expect(bangkokHour(new Date('2026-11-18T14:00:00Z'))).toBe(21);
  });

  it('formats Thai dates with Buddhist era years', () => {
    expect(formatThaiShort('2026-11-18')).toBe('18 พ.ย.');
    expect(formatThaiShort('2026-11-18', true)).toBe('18 พ.ย. 69');
    expect(formatThaiMonthYear(2026, 11)).toBe('พฤศจิกายน 2569');
  });
});

describe('budget periods', () => {
  it('calendar-month periods (start day 1)', () => {
    const p = periodForDate('2026-02-14');
    expect(p).toMatchObject({ key: '2026-02', start: '2026-02-01', end: '2026-02-28' });
    expect(periodLengthDays(p)).toBe(28);
    expect(periodForDate('2028-02-29')).toMatchObject({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('payday cycles (start day 25)', () => {
    expect(periodForDate('2026-11-24', 25)).toMatchObject({ key: '2026-10', start: '2026-10-25', end: '2026-11-24' });
    expect(periodForDate('2026-11-25', 25)).toMatchObject({ key: '2026-11', start: '2026-11-25', end: '2026-12-24' });
    // across year end
    expect(periodForDate('2027-01-10', 25)).toMatchObject({ key: '2026-12', start: '2026-12-25', end: '2027-01-24' });
  });

  it('start day 28 across February in leap and non-leap years', () => {
    expect(periodForDate('2026-02-27', 28)).toMatchObject({ start: '2026-01-28', end: '2026-02-27' });
    expect(periodForDate('2026-02-28', 28)).toMatchObject({ start: '2026-02-28', end: '2026-03-27' });
    expect(periodForDate('2028-02-29', 28)).toMatchObject({ start: '2028-02-28', end: '2028-03-27' });
  });

  it('every day belongs to exactly one period and periods are contiguous', () => {
    for (const startDay of [1, 15, 25, 28]) {
      let p = periodForDate('2026-01-01', startDay);
      for (let i = 0; i < 30; i++) {
        const n = nextPeriod(p);
        expect(addDays(p.end, 1)).toBe(n.start);
        expect(previousPeriod(n)).toEqual(p);
        p = n;
      }
    }
  });

  it('rejects start days that do not exist in every month', () => {
    expect(() => periodForDate('2026-01-01', 29)).toThrow();
    expect(() => periodForDate('2026-01-01', 0)).toThrow();
    expect(() => periodFromKey('2026-13')).toThrow();
  });

  it('counts remaining days including today', () => {
    const p = periodFromKey('2026-11');
    expect(daysRemainingInclusive(p, '2026-11-01')).toBe(30);
    expect(daysRemainingInclusive(p, '2026-11-30')).toBe(1);
    expect(daysRemainingInclusive(p, '2026-12-01')).toBe(0);
    expect(daysRemainingInclusive(p, '2026-10-15')).toBe(30);
  });
});
