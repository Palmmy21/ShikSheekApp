import { describe, expect, it } from 'vitest';
import {
  divideFloor,
  formatBaht,
  formatSatang,
  isValidPositiveAmount,
  MAX_AMOUNT_SATANG,
  parseBahtToSatang,
  ratioBasisPoints,
  sumSatang,
} from '../../src/domain/money.ts';

describe('parseBahtToSatang', () => {
  it.each([
    ['65', 6_500],
    ['0', 0],
    ['65.5', 6_550],
    ['65.50', 6_550],
    ['0.01', 1],
    ['25000', 2_500_000],
    ['1,250', 125_000],
    ['1,250.75', 125_075],
    ['1,000,000', 100_000_000],
    ['  80  ', 8_000],
  ])('%s -> %i satang', (input, expected) => {
    expect(parseBahtToSatang(input)).toBe(expected);
  });

  it('is exact where floats are not (0.1 + 0.2 style inputs)', () => {
    expect(parseBahtToSatang('0.29')).toBe(29);
    expect(parseBahtToSatang('1.15')).toBe(115);
    expect(parseBahtToSatang('19.99')).toBe(1_999);
  });

  it.each(['', 'abc', '-50', '1.234', '1,25', '12,34,567', '1e5', '.5', '5.', '๕๐', '50 บาท'])('rejects %j', (input) => {
    expect(parseBahtToSatang(input)).toBeNull();
  });

  it('rejects numbers too large to be safe', () => {
    expect(parseBahtToSatang('99999999999999999')).toBeNull();
  });
});

describe('formatSatang / formatBaht', () => {
  it('formats with thousands separators and drops .00', () => {
    expect(formatSatang(2_500_000)).toBe('25,000');
    expect(formatSatang(6_550)).toBe('65.50');
    expect(formatSatang(1)).toBe('0.01');
    expect(formatSatang(0)).toBe('0');
    expect(formatSatang(123_456_789)).toBe('1,234,567.89');
  });

  it('keeps fractions when asked and handles negatives and signs', () => {
    expect(formatSatang(6_500, { alwaysShowFraction: true })).toBe('65.00');
    expect(formatSatang(-150_050)).toBe('-1,500.50');
    expect(formatSatang(500, { withSign: true })).toBe('+5');
    expect(formatBaht(-150_000)).toBe('-฿1,500');
    expect(formatBaht(150_000, { withSign: true })).toBe('+฿1,500');
    expect(formatBaht(8_000)).toBe('฿80');
  });

  it('refuses non-integer satang', () => {
    expect(() => formatSatang(1.5)).toThrow();
  });
});

describe('arithmetic helpers', () => {
  it('sumSatang adds integers and rejects floats', () => {
    expect(sumSatang([100, 250, 1])).toBe(351);
    expect(sumSatang([])).toBe(0);
    expect(() => sumSatang([100, 0.5])).toThrow();
  });

  it('ratioBasisPoints floors and guards zero/negative bases', () => {
    expect(ratioBasisPoints(5_000, 10_000)).toBe(5_000);
    expect(ratioBasisPoints(7_999, 10_000)).toBe(7_999);
    expect(ratioBasisPoints(1, 3)).toBe(3_333);
    expect(ratioBasisPoints(15_000, 10_000)).toBe(15_000);
    expect(ratioBasisPoints(100, 0)).toBe(0);
    expect(ratioBasisPoints(100, -5)).toBe(0);
  });

  it('divideFloor floors toward negative infinity', () => {
    expect(divideFloor(1_000, 3)).toBe(333);
    expect(divideFloor(-1_000, 3)).toBe(-334);
    expect(() => divideFloor(100, 0)).toThrow();
  });

  it('isValidPositiveAmount enforces bounds', () => {
    expect(isValidPositiveAmount(1)).toBe(true);
    expect(isValidPositiveAmount(MAX_AMOUNT_SATANG)).toBe(true);
    expect(isValidPositiveAmount(MAX_AMOUNT_SATANG + 1)).toBe(false);
    expect(isValidPositiveAmount(0)).toBe(false);
    expect(isValidPositiveAmount(10.5)).toBe(false);
  });
});
