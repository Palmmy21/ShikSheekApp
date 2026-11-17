/**
 * Money primitives. All amounts are integer satang (1 baht = 100 satang).
 * Floating point is never used for money: parsing works on the decimal string.
 */

export type Satang = number;

/** Upper bound for a single amount: 1,000,000,000 baht. Well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_SATANG = 100_000_000_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertSatang(value: number, label = 'amount'): asserts value is Satang {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of satang, got ${value}`);
  }
}

export function isValidPositiveAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_SATANG;
}

const BAHT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse a baht string such as "65", "1,250.5", "25000.00" into satang.
 * Returns null when the text is not a plain, non-negative baht amount.
 */
export function parseBahtToSatang(input: string): Satang | null {
  const text = input.trim();
  const match = BAHT_PATTERN.exec(text);
  if (!match) return null;
  const whole = match[1]!.replace(/,/g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  // Reject absurd lengths before converting to keep the result a safe integer.
  if (whole.length > 13) return null;
  const satang = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(satang)) return null;
  return satang;
}

export function bahtToSatang(baht: number): Satang {
  // Only for trusted integer/2-decimal literals (tests, config). Rounds half away from zero.
  const satang = Math.round(baht * 100);
  assertSatang(satang);
  return satang;
}

export function sumSatang(values: Iterable<Satang>): Satang {
  let total = 0;
  for (const v of values) {
    assertSatang(v);
    total += v;
  }
  assertSatang(total, 'sum');
  return total;
}

/**
 * Format satang for display: 650050 -> "6,500.50", 2500000 -> "25,000".
 * Fractions are shown only when non-zero (or when `alwaysShowFraction`).
 */
export function formatSatang(
  satang: Satang,
  opts: { alwaysShowFraction?: boolean; withSign?: boolean } = {},
): string {
  assertSatang(satang);
  const negative = satang < 0;
  const abs = Math.abs(satang);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const showFraction = opts.alwaysShowFraction || fraction !== 0;
  const body = showFraction ? `${wholeText}.${fraction.toString().padStart(2, '0')}` : wholeText;
  if (negative) return `-${body}`;
  if (opts.withSign && satang > 0) return `+${body}`;
  return body;
}

/** "฿6,500.50" style. */
export function formatBaht(satang: Satang, opts?: { alwaysShowFraction?: boolean; withSign?: boolean }): string {
  const text = formatSatang(satang, opts);
  return text.startsWith('-') ? `-฿${text.slice(1)}` : text.startsWith('+') ? `+฿${text.slice(1)}` : `฿${text}`;
}

/**
 * Integer percentage in basis points (1% = 100 bp), floored. Avoids float drift
 * when comparing against thresholds. Returns 0 when the base is 0 or negative.
 */
export function ratioBasisPoints(part: Satang, whole: Satang): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10_000) / whole);
}

/** Floor division that stays correct for negatives (used for per-day allowances). */
export function divideFloor(amount: Satang, parts: number): Satang {
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError('parts must be a positive integer');
  return Math.floor(amount / parts);
}
