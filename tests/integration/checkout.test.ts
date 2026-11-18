import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { runScheduledJobs } from '../../src/application/jobs.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import { signJwt, verifyJwt } from '../../src/infrastructure/payments/jwt.ts';
import { createTwoC2PGateway } from '../../src/infrastructure/payments/twoc2p.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handlePaymentNotification } from '../../src/presentation/payments/webhook.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

const MERCHANT = 'MERCHANT01';
const SECRET = 'test-2c2p-secret-key-0123456789';

/** A tiny fake of 2C2P PGW v4.5: signed JWT in and out, invoices paid on demand. */
class Fake2C2P {
  invoices = new Map<string, { amount: number; paid: boolean; channels: unknown }>();
  amountOverride: string | null = null;
  calls: string[] = [];
  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.slice(url.lastIndexOf('/'));
    this.calls.push(path);
    expect(url.startsWith('https://sandbox-pgw.2c2p.com/payment/4.5/')).toBe(true);
    const req = await verifyJwt(JSON.parse(String(init!.body)).payload, SECRET);
    if (!req || req.merchantID !== MERCHANT) return Response.json({ respCode: '9042', respDesc: 'bad signature' });
    const invoiceNo = String(req.invoiceNo);
    if (path === '/paymentToken') {
      expect(req).toMatchObject({ currencyCode: 'THB', paymentChannel: ['QR'] });
      this.invoices.set(invoiceNo, { amount: req.amount as number, paid: false, channels: req.paymentChannel });
      return Response.json({ payload: await signJwt({ webPaymentUrl: `https://sandbox-pgw-ui.2c2p.com/pay/${invoiceNo}`, paymentToken: `tok_${invoiceNo}`, respCode: '0000', respDesc: 'Success' }, SECRET) });
    }
    if (path === '/paymentInquiry') {
      const inv = this.invoices.get(invoiceNo);
      const paid = inv?.paid;
      return Response.json({
        payload: await signJwt({
          merchantID: MERCHANT, invoiceNo, amount: this.amountOverride ?? `${inv?.amount.toFixed(2)}000`, currencyCode: 'THB',
          channelCode: 'PPQR', referenceNo: `ref_${invoiceNo}`, respCode: paid ? '0000' : '4200', respDesc: paid ? 'Success' : 'Pending',
        }, SECRET),
      });
    }
    return new Response('nope', { status: 404 });
  };
  async notification(invoiceNo: string, secret = SECRET) {
    return { payload: await signJwt({ merchantID: MERCHANT, invoiceNo, respCode: '0000', respDesc: 'Success' }, secret) };
  }
}

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
let pg: Fake2C2P;
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
  pg = new Fake2C2P();
  clockNow = new Date('2026-11-18T03:00:00Z');
  const gateway = createTwoC2PGateway({ merchantId: MERCHANT, secretKey: SECRET, env: 'sandbox', channels: ['QR'], fetch: pg.fetch });
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
const notify = (body: unknown) => handlePaymentNotification(new Request('https://x/payment-webhook', { method: 'POST', body: JSON.stringify(body) }), deps);

async function startCheckout(product = 'plus_monthly') {
  const msgs = await tap(`a=pay_start&p=${product}`);
  const payment = (await db.sql.query<{ id: string; invoice_no: string; amount_satang: unknown }>(`select id, invoice_no, amount_satang from payments where user_id = $1 order by created_at desc limit 1`, [U]))[0]!;
  return { msgs, payment };
}

describe('PromptPay checkout via 2C2P', () => {
  it('plan cards show buy buttons with the early-bird yearly price', async () => {
    const msgs = await send(textEvent(U, 'แพ็กเกจ'));
    expect(all(msgs)).toContain('a=pay_start&p=plus_early');
    expect(all(msgs)).toContain('a=pay_start&p=pro_monthly');
    expect(all(msgs)).not.toContain('plan_interest');
  });

  it('pay → signed notification → inquiry confirms → Plus granted once, user notified', async () => {
    const { msgs, payment } = await startCheckout();
    expect(all(msgs)).toContain(`https://sandbox-pgw-ui.2c2p.com/pay/${payment.invoice_no}`);
    expect(Number(payment.amount_satang)).toBe(4900);

    // notification before the money arrives: nothing granted
    expect((await notify(await pg.notification(payment.invoice_no))).status).toBe(200);
    expect((await deps.plans.status(U)).plan).toBe('free');

    pg.invoices.get(payment.invoice_no)!.paid = true;
    expect((await notify(await pg.notification(payment.invoice_no))).status).toBe(200);
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'plus', source: 'paid', daysLeft: 30 });
    expect(line.pushes).toHaveLength(1);
    expect(alt(line.pushes[0]!.messages)).toContain('ได้รับเงินแล้ว');

    // retries / duplicates never extend twice or re-notify
    await notify(await pg.notification(payment.invoice_no));
    expect(line.pushes).toHaveLength(1);
    await tap(`a=pay_check&id=${payment.id}`); // (tap resets the fake client)
    expect(line.pushes).toHaveLength(0);
    expect((await deps.plans.status(U)).daysLeft).toBe(30);
  });

  it('forged or foreign notifications are ignored', async () => {
    const { payment } = await startCheckout();
    pg.invoices.get(payment.invoice_no)!.paid = false;
    await notify(await pg.notification(payment.invoice_no, 'attacker-secret-0000000000'));
    await notify({ payload: 'not.a.jwt' });
    await notify({ hello: 'world' });
    expect((await deps.plans.status(U)).plan).toBe('free');
  });

  it('an amount mismatch from 2C2P is never accepted', async () => {
    const { payment } = await startCheckout();
    pg.invoices.get(payment.invoice_no)!.paid = true;
    pg.amountOverride = '4.90';
    await notify(await pg.notification(payment.invoice_no));
    expect((await deps.plans.status(U)).plan).toBe('free');
  });

  it('"จ่ายแล้ว ตรวจสอบ" settles without waiting for the notification', async () => {
    const { payment } = await startCheckout('pro_yearly');
    expect(alt(await tap(`a=pay_check&id=${payment.id}`))).toContain('ยังไม่เห็นการชำระเงิน');
    pg.invoices.get(payment.invoice_no)!.paid = true;
    expect(alt(await tap(`a=pay_check&id=${payment.id}`))).toContain('ชิกชิก Pro');
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'pro', daysLeft: 365 });
  });

  it('double tap reuses the same QR; early bird is once per user', async () => {
    const a = await startCheckout('plus_early');
    const b = await startCheckout('plus_early');
    expect(b.payment.id).toBe(a.payment.id);
    expect(pg.calls.filter((c) => c === '/paymentToken')).toHaveLength(1);
    pg.invoices.get(a.payment.invoice_no)!.paid = true;
    await notify(await pg.notification(a.payment.invoice_no));
    expect(await deps.payments!.earlyBirdAvailable(U)).toBe(false);
    expect(all(await send(textEvent(U, 'แพ็กเกจ')))).toContain('a=pay_start&p=plus_yearly');
  });

  it('renewal reminder 3 days before the end, and a notice after it ends', async () => {
    const { payment } = await startCheckout();
    pg.invoices.get(payment.invoice_no)!.paid = true;
    await notify(await pg.notification(payment.invoice_no));
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
