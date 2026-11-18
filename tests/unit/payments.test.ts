import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyPurchase } from '../../src/domain/plans.ts';
import { newInvoiceNo } from '../../src/application/services/payment-service.ts';
import { verifyStripeSignature } from '../../src/infrastructure/payments/stripe.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-18T00:00:00Z');
const SECRET = 'whsec_test_secret';
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('Stripe webhook signature', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } });
  const t = Math.floor(NOW / 1000);
  it('accepts a valid v1 signature within tolerance', async () => {
    expect(await verifyStripeSignature(body, sign(body, t), SECRET, NOW)).toBe(true);
    expect(await verifyStripeSignature(body, `${sign(body, t, 'old_secret')},v1=${sign(body, t).split('v1=')[1]}`, SECRET, NOW)).toBe(true); // rolled secrets
  });
  it('rejects tampering, wrong secrets, stale timestamps and junk', async () => {
    expect(await verifyStripeSignature(body.replace('cs_test_1', 'cs_test_2'), sign(body, t), SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(body, sign(body, t, 'whsec_other'), SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(body, sign(body, t - 600), SECRET, NOW)).toBe(false);
    for (const h of [null, '', 'garbage', `t=${t}`, 'v1=abc']) expect(await verifyStripeSignature(body, h, SECRET, NOW)).toBe(false);
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

it('invoice numbers are 20 unguessable alphanumerics and do not repeat', () => {
  const seen = new Set(Array.from({ length: 500 }, newInvoiceNo));
  expect(seen.size).toBe(500);
  for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9]{20}$/);
});
