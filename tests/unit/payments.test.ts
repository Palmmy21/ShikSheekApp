import { describe, expect, it } from 'vitest';
import { applyPurchase } from '../../src/domain/plans.ts';
import { newInvoiceNo } from '../../src/application/services/payment-service.ts';
import { signJwt, verifyJwt } from '../../src/infrastructure/payments/jwt.ts';
import { decimalToSatang } from '../../src/infrastructure/payments/twoc2p.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-18T00:00:00Z');

describe('HS256 JWT', () => {
  it('round-trips Thai text and rejects tampering, wrong keys and alg=none', async () => {
    const t = await signJwt({ invoiceNo: 'ABC', description: 'ชิกชิก Plus', amount: 49 }, 'secret-key-1234567890');
    expect(await verifyJwt(t, 'secret-key-1234567890')).toEqual({ invoiceNo: 'ABC', description: 'ชิกชิก Plus', amount: 49 });
    expect(await verifyJwt(t, 'another-secret-12345')).toBeNull();
    const [h, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ invoiceNo: 'ABC', amount: 1 })).toString('base64url');
    expect(await verifyJwt(`${h}.${forged}.${s}`, 'secret-key-1234567890')).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    expect(await verifyJwt(`${none}.${p}.`, 'secret-key-1234567890')).toBeNull();
    expect(await verifyJwt('garbage', 'secret-key-1234567890')).toBeNull();
  });
});

describe('decimalToSatang (no floats)', () => {
  it.each([
    ['49', 4900],
    ['49.00', 4900],
    ['1090.00000', 109000],
    ['0.5', 50],
    [49, 4900],
  ])('%s → %s', (v, out) => expect(decimalToSatang(v)).toBe(out));
  it('rejects junk and sub-satang amounts', () => {
    for (const v of ['49.001', '-1', 'abc', '', null, '1e3']) expect(decimalToSatang(v)).toBeNull();
  });
});

describe('applyPurchase', () => {
  it('starts now when nothing is active', () => {
    expect(applyPurchase(null, 'plus_monthly', NOW)).toEqual({ plan: 'plus', end: NOW + 30 * DAY });
    expect(applyPurchase({ plan: 'plus', end: NOW - DAY }, 'pro_yearly', NOW)).toEqual({ plan: 'pro', end: NOW + 365 * DAY });
  });
  it('same plan extends from the current end (renewing early never loses days)', () => {
    expect(applyPurchase({ plan: 'plus', end: NOW + 10 * DAY }, 'plus_monthly', NOW).end).toBe(NOW + 40 * DAY);
  });
  it('switching converts unused time at the monthly price ratio', () => {
    // 129 days of Plus (฿49/m) is worth 49 days of Pro (฿129/m)
    expect(applyPurchase({ plan: 'plus', end: NOW + 129 * DAY }, 'pro_monthly', NOW)).toEqual({ plan: 'pro', end: NOW + 49 * DAY + 30 * DAY });
    expect(applyPurchase({ plan: 'pro', end: NOW + 49 * DAY }, 'plus_monthly', NOW)).toEqual({ plan: 'plus', end: NOW + 129 * DAY + 30 * DAY });
  });
});

it('invoice numbers fit 2C2P QR rules (≤20 alphanumerics) and do not repeat', () => {
  const seen = new Set(Array.from({ length: 500 }, newInvoiceNo));
  expect(seen.size).toBe(500);
  for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9]{20}$/);
});
