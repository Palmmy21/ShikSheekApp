import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { runScheduledJobs } from '../../src/application/jobs.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import { createHmac } from 'node:crypto';
import { createStripeGateway } from '../../src/infrastructure/payments/stripe.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handlePaymentNotification } from '../../src/presentation/payments/webhook.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

const WHSEC = 'whsec_test_123';

/** A tiny fake of the Stripe API: Checkout Sessions, paid on demand, signed webhooks. */
class FakeStripe {
  sessions = new Map<string, { id: string; ref: string; amount: number; paid: boolean; currency: string }>();
  amountOverride: number | null = null;
  calls: string[] = [];
  n = 0;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    this.calls.push(`${init?.method} ${url.pathname}`);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk_test_x');
    if (init?.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const f = new URLSearchParams(String(init.body));
      expect(f.get('mode')).toBe('payment');
      expect(f.get('payment_method_types[0]')).toBeNull(); // removed from Stripe's API
      expect(f.get('line_items[0][price_data][currency]')).toBe('thb');
      expect(f.get('success_url')).toContain('{CHECKOUT_SESSION_ID}');
      const id = `cs_test_${++this.n}`;
      this.sessions.set(id, { id, ref: f.get('client_reference_id')!, amount: Number(f.get('line_items[0][price_data][unit_amount]')), paid: false, currency: 'thb' });
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    const m = /^\/v1\/checkout\/sessions\/(cs_test_\d+)$/.exec(url.pathname);
    if (init?.method === 'GET' && m) {
      const s = this.sessions.get(m[1]!);
      if (!s) return Response.json({ error: { code: 'resource_missing', message: 'No such session' } }, { status: 404 });
      return Response.json({
        id: s.id, object: 'checkout.session', client_reference_id: s.ref, currency: s.currency,
        amount_total: this.amountOverride ?? s.amount, payment_status: s.paid ? 'paid' : 'unpaid', status: s.paid ? 'complete' : 'open',
        payment_intent: s.paid ? `pi_${s.id}` : null, payment_method_types: ['promptpay'],
      });
    }
    return new Response('nope', { status: 404 });
  };
  sessionFor(invoiceNo: string) {
    return [...this.sessions.values()].find((s) => s.ref === invoiceNo)!;
  }
  pay(invoiceNo: string) {
    this.sessionFor(invoiceNo).paid = true;
  }
  event(invoiceNo: string, opts: { secret?: string; type?: string; t?: number } = {}) {
    const s = this.sessionFor(invoiceNo);
    const body = JSON.stringify({ id: 'evt_1', type: opts.type ?? 'checkout.session.completed', data: { object: { object: 'checkout.session', id: s.id, client_reference_id: invoiceNo } } });
    const t = opts.t ?? Math.floor(clockNow.getTime() / 1000);
    return { body, sig: `t=${t},v1=${createHmac('sha256', opts.secret ?? WHSEC).update(`${t}.${body}`).digest('hex')}` };
  }
}

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
let pg: FakeStripe;
const U = testUserId(0xc0c);
let clockNow = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  line = new FakeLineClient();
  pg = new FakeStripe();
  clockNow = new Date('2026-11-18T03:00:00Z');
  const gateway = createStripeGateway({ secretKey: 'sk_test_x', webhookSecret: WHSEC, fetch: pg.fetch, now: () => clockNow.getTime() });
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai: null, gateway, clock: () => clockNow, log: silent });
  await deps.repos.users.ensure(U, 'ปาล์ม');
  await deps.repos.users.setOnboarding(U, 'done');
  await db.sql.query(`update users set created_at = '2026-09-01T00:00:00Z' where line_user_id = $1`, [U]); // trial over
});

async function send(event: unknown): Promise<Message[]> {
  line.reset();
  const { body, signature } = await signedBody([event]);
  await (await handleWebhookRequest(body, signature, CHANNEL_SECRET, deps)).work;
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  return msgs;
}
const tap = (data: string) => send(postbackEvent(U, data));
const all = (m: Message[]) => JSON.stringify(m);
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const notify = (e: { body: string; sig: string }) => handlePaymentNotification(new Request('https://x/payment-webhook', { method: 'POST', body: e.body, headers: { 'stripe-signature': e.sig } }), deps);

async function startCheckout(product = 'plus_monthly') {
  const msgs = await tap(`a=pay_start&p=${product}`);
  const payment = (await db.sql.query<{ id: string; invoice_no: string; amount_satang: unknown; gateway_ref: string }>(`select id, invoice_no, amount_satang, gateway_ref from payments where user_id = $1 order by created_at desc limit 1`, [U]))[0]!;
  return { msgs, payment };
}

describe('PromptPay checkout via Stripe', () => {
  it('plan cards show buy buttons with the early-bird yearly price', async () => {
    const msgs = await send(textEvent(U, 'แพ็กเกจ'));
    expect(all(msgs)).toContain('a=pay_start&p=plus_early');
    expect(all(msgs)).toContain('a=pay_start&p=pro_monthly');
    expect(all(msgs)).not.toContain('plan_interest');
  });

  it('pay → signed webhook → session re-fetch confirms → Plus granted once, user notified', async () => {
    const { msgs, payment } = await startCheckout();
    expect(all(msgs)).toContain(`https://checkout.stripe.com/c/pay/${payment.gateway_ref}`);
    expect(Number(payment.amount_satang)).toBe(4900);

    // notification before the money arrives: nothing granted
    expect((await notify(pg.event(payment.invoice_no))).status).toBe(200);
    expect((await deps.plans.status(U)).plan).toBe('free');

    pg.pay(payment.invoice_no);
    expect((await notify(pg.event(payment.invoice_no))).status).toBe(200);
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'plus', source: 'paid', daysLeft: 30 });
    expect(line.pushes).toHaveLength(1);
    expect(alt(line.pushes[0]!.messages)).toContain('ยินดีต้อนรับสู่ครอบครัวชิกชิก');

    // retries / duplicates never extend twice or re-notify
    await notify(pg.event(payment.invoice_no));
    expect(line.pushes).toHaveLength(1);
    await tap(`a=pay_check&id=${payment.id}`); // (tap resets the fake client)
    expect(line.pushes).toHaveLength(0);
    expect((await deps.plans.status(U)).daysLeft).toBe(30);
  });

  it('forged, replayed or irrelevant webhooks are ignored', async () => {
    const { payment } = await startCheckout();
    await notify(pg.event(payment.invoice_no, { secret: 'whsec_attacker' }));
    pg.pay(payment.invoice_no); // even when actually paid, a bad signature must not settle
    await notify({ body: pg.event(payment.invoice_no).body, sig: 'garbage' });
    await notify(pg.event(payment.invoice_no, { t: Math.floor(clockNow.getTime() / 1000) - 3600 })); // replayed
    await notify(pg.event(payment.invoice_no, { type: 'payment_intent.created' })); // irrelevant event
    expect(line.pushes).toHaveLength(0);
    expect((await deps.plans.status(U)).plan).toBe('free');
  });

  it('an amount mismatch is never accepted', async () => {
    const { payment } = await startCheckout();
    pg.pay(payment.invoice_no);
    pg.amountOverride = 490;
    await notify(pg.event(payment.invoice_no));
    expect((await deps.plans.status(U)).plan).toBe('free');
  });

  it('"จ่ายแล้ว ตรวจสอบ" settles without waiting for the notification', async () => {
    const { payment } = await startCheckout('pro_yearly');
    expect(alt(await tap(`a=pay_check&id=${payment.id}`))).toContain('ยังไม่เห็นการชำระเงิน');
    pg.pay(payment.invoice_no);
    expect(alt(await tap(`a=pay_check&id=${payment.id}`))).toContain('ชิกชิก Pro');
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'pro', daysLeft: 365 });
  });

  it('double tap reuses the same QR; early bird is once per user', async () => {
    const a = await startCheckout('plus_early');
    const b = await startCheckout('plus_early');
    expect(b.payment.id).toBe(a.payment.id);
    expect(pg.calls.filter((c) => c === 'POST /v1/checkout/sessions')).toHaveLength(1);
    pg.pay(a.payment.invoice_no);
    await notify(pg.event(a.payment.invoice_no));
    expect(await deps.payments!.earlyBirdAvailable(U)).toBe(false);
    expect(all(await send(textEvent(U, 'แพ็กเกจ')))).toContain('a=pay_start&p=plus_yearly');
  });

  it('renewal reminder 3 days before the end, and a notice after it ends', async () => {
    const { payment } = await startCheckout();
    pg.pay(payment.invoice_no);
    await notify(pg.event(payment.invoice_no));
    line.reset();
    const inDays = (d: number, hour = '10:00') => new Date(Date.parse(`2026-11-18T${hour}:00+07:00`) + d * 86_400_000);
    await runScheduledJobs(deps, inDays(28), ['renewal_reminders']);
    await runScheduledJobs(deps, inDays(28, '11:00'), ['renewal_reminders']);
    expect(line.pushes).toHaveLength(1);
    expect(alt(line.pushes[0]!.messages)).toContain('จะหมดอายุ');
    clockNow = inDays(30, '23:00');
    await runScheduledJobs(deps, inDays(30, '23:00'), ['renewal_reminders']);
    expect(alt(line.pushes.at(-1)!.messages)).toContain('หมดอายุแล้ว');
  });
});

describe('test-mode safety', () => {
  const cfg = { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined };
  it('with a test key only allow-listed testers can buy; others keep the waitlist', async () => {
    const d = createAppDeps(db.sql, { ...cfg, STRIPE_SECRET_KEY: 'sk_test_abc', PAYMENT_TEST_USERS: `${U}, Uother` }, { line, ai: null, log: silent });
    expect(d.payments!.availableFor(U)).toBe(true);
    expect(d.payments!.availableFor('Ustranger')).toBe(false);
    await expect(d.payments!.checkout('Ustranger', 'plus_monthly')).rejects.toThrow();
    const none = createAppDeps(db.sql, { ...cfg, STRIPE_SECRET_KEY: 'sk_test_abc' }, { line, ai: null, log: silent });
    expect(none.payments!.availableFor(U)).toBe(false);
  });
  it('a live key opens checkout to everyone', () => {
    const d = createAppDeps(db.sql, { ...cfg, STRIPE_SECRET_KEY: 'sk_live_abc' }, { line, ai: null, log: silent });
    expect(d.payments!.availableFor('Uanyone')).toBe(true);
  });
  it('"ไอดีของฉัน" replies with the user\'s own LINE id', async () => {
    expect(JSON.stringify(await send(textEvent(U, 'ไอดีของฉัน')))).toContain(U);
  });
});

describe('membership bookkeeping', () => {
  it('first payment: fee recorded as an expense, member_since set, "converted" logged; later buys are renewed/upgraded', async () => {
    const { payment } = await startCheckout('plus_monthly');
    pg.pay(payment.invoice_no);
    await notify(pg.event(payment.invoice_no));
    await notify(pg.event(payment.invoice_no)); // duplicate delivery
    expect(alt(line.pushes[0]!.messages)).toContain('ยินดีต้อนรับสู่ครอบครัวชิกชิก Plus');
    expect(alt(line.pushes[0]!.messages)).toContain('จดค่าสมาชิก ฿49');

    const fees = (await deps.repos.transactions.listRecent(U, 10)).filter((t) => t.source === 'payment');
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ type: 'expense', amountSatang: 4900, categoryId: 'bills', note: 'ค่าสมาชิก ชิกชิก Plus รายเดือน' });
    const [u] = await db.sql.query<{ member_since: unknown }>(`select member_since from users where line_user_id = $1`, [U]);
    expect(u!.member_since).not.toBeNull();

    const renew = await startCheckout('plus_yearly');
    pg.pay(renew.payment.invoice_no);
    await notify(pg.event(renew.payment.invoice_no));
    const up = await startCheckout('pro_monthly');
    pg.pay(up.payment.invoice_no);
    await notify(pg.event(up.payment.invoice_no));
    const events = await db.sql.query<{ event: string }>(`select event from plan_events where user_id = $1 order by created_at, event`, [U]);
    expect(events.map((e) => e.event).sort()).toEqual(['converted', 'renewed', 'upgraded']);
    const [u2] = await db.sql.query<{ member_since: unknown }>(`select member_since from users where line_user_id = $1`, [U]);
    expect(String(u2!.member_since)).toBe(String(u!.member_since)); // first conversion date kept
    expect((await deps.repos.transactions.listRecent(U, 10)).filter((t) => t.source === 'payment')).toHaveLength(3);
  });
});
