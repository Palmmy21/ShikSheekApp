import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { runScheduledJobs } from '../../src/application/jobs.ts';
import { PlanLimitError } from '../../src/application/services/entitlement-service.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { AiClient } from '../../src/infrastructure/ai/claude.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handleApiRequest } from '../../src/presentation/api/router.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
let aiCalls = 0;
const U = testUserId(0x91a);
const TODAY = '2026-11-18';
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const ai: AiClient = {
  interpret: async () => ((aiCalls += 1), null),
  phrase: async () => null,
  extractDocument: async () => ({ kind: 'not_financial', rows: [] }) as never,
};
const make = (clock = () => NOW) =>
  createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai, clock, log: silent });

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  line = new FakeLineClient();
  deps = make();
  aiCalls = 0;
  await deps.repos.users.ensure(U, 'ปาล์ม');
  await deps.repos.users.setOnboarding(U, 'done');
});

/** Make the user old enough that the free Pro trial is over. */
const endTrial = () => db.sql.query(`update users set created_at = '2026-09-01T00:00:00Z' where line_user_id = $1`, [U]);
const grant = (plan: 'plus' | 'pro', end = '2026-12-31T00:00:00Z') => deps.repos.plans.setSubscription(U, plan, 'manual', new Date(end));

async function send(event: unknown): Promise<Message[]> {
  line.reset();
  const { body, signature } = await signedBody([event]);
  await (await handleWebhookRequest(body, signature, CHANNEL_SECRET, deps)).work;
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  return msgs;
}
const say = (t: string) => send(textEvent(U, t));
const tap = (data: string) => send(postbackEvent(U, data));
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const all = (msgs: Message[]) => JSON.stringify(msgs);
const bill = (name: string) =>
  deps.fixedCosts.create(U, { name, amountSatang: 10_000, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-11-25' } }, TODAY);

describe('plan status', () => {
  it('new users get a 14-day Pro trial; afterwards they are on Free', async () => {
    await db.sql.query(`update users set created_at = $2 where line_user_id = $1`, [U, NOW.toISOString()]);
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'pro', source: 'trial', daysLeft: 14 });
    await endTrial();
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'free', source: 'free', until: null });
  });

  it('a granted plan counts until it ends; the higher of trial/paid wins', async () => {
    await endTrial();
    await grant('plus');
    expect(await deps.plans.status(U)).toMatchObject({ plan: 'plus', source: 'paid' });
    await grant('plus', '2026-11-01T00:00:00Z'); // expired
    expect((await deps.plans.status(U)).plan).toBe('free');
    await db.sql.query(`update users set created_at = $2 where line_user_id = $1`, [U, NOW.toISOString()]);
    await grant('plus');
    expect((await deps.plans.status(U)).plan).toBe('pro'); // trial Pro beats paid Plus
  });

  it('grant_plan() SQL helper extends from the later of now/current end', async () => {
    await db.sql.query(`select grant_plan($1, 'pro', 30, 'promo')`, [U]);
    const first = (await deps.repos.plans.getSubscription(U))!;
    await db.sql.query(`select grant_plan($1, 'pro', 30, 'promo')`, [U]);
    const second = (await deps.repos.plans.getSubscription(U))!;
    expect(Date.parse(second.currentPeriodEnd) - Date.parse(first.currentPeriodEnd)).toBe(30 * 86_400_000);
    expect(second).toMatchObject({ plan: 'pro', source: 'promo' });
  });

  it('"แพ็กเกจ" shows status + Plus/Pro cards; "สนใจ" is recorded once', async () => {
    await endTrial();
    const msgs = await say('แพ็กเกจ');
    expect(all(msgs)).toContain('แพ็กเกจฟรี');
    expect(all(msgs)).toContain('a=plan_interest&p=plus');
    expect(alt(await tap('a=plan_interest&p=plus'))).toContain('จดชื่อไว้แล้ว');
    expect(alt(await tap('a=plan_interest&p=plus'))).toContain('จดไว้แล้วน้า');
    expect(await db.sql.query(`select * from plan_interest where user_id = $1`, [U])).toHaveLength(1);
  });
});

describe('Free limits block adding more, never existing data', () => {
  beforeEach(endTrial);

  it('fixed costs: 3 allowed, the 4th shows the upgrade card; existing ones keep working', async () => {
    for (const n of ['ค่าห้อง', 'ค่าเน็ต', 'ค่าไฟ']) await bill(n);
    const msgs = await tap('a=fc_add');
    expect(alt(msgs)).toContain('ตั้งบิลประจำได้ 3 รายการ');
    expect(all(msgs)).toContain('a=plan_interest&p=plus');
    await expect(deps.plans.assertCanAdd(U, 'fixed_costs')).rejects.toBeInstanceOf(PlanLimitError);
    expect(alt(await tap('a=fixed_costs'))).not.toContain('ตั้งบิลประจำได้'); // list still opens
  });

  it('budgets: total is free, per-category is Plus; an existing category budget can still be edited', async () => {
    expect(alt(await say('ตั้งงบรวม 10000'))).toContain('ตั้งงบ');
    expect(alt(await tap('a=budget_pick_category&c=food'))).toContain('งบรายหมวดเป็นของ Plus');
    await deps.finance.setBudget(U, 'food', 300_000); // e.g. created during the trial
    await expect(deps.plans.assertCanAdd(U, 'category_budget', 'food')).resolves.toBeUndefined();
  });

  it('goals: 1 on Free, 5 on Plus, unlimited on Pro', async () => {
    await deps.finance.createGoal(U, { name: 'ญี่ปุ่น', targetSatang: 100_000, monthlyReserveSatang: 0 });
    expect(alt(await tap('a=goal_add'))).toContain('ตั้งเป้าออมได้ 1 เป้า');
    await grant('plus');
    for (let i = 0; i < 4; i++) await deps.finance.createGoal(U, { name: `g${i}`, targetSatang: 100_000, monthlyReserveSatang: 0 });
    const msgs = await tap('a=goal_add');
    expect(alt(msgs)).toContain('แพ็กเกจ Plus ตั้งเป้าออมได้ 5 เป้า');
    expect(all(msgs)).toContain('a=plan_interest&p=pro'); // Plus users are pointed to Pro
    await grant('pro');
    await expect(deps.plans.assertCanAdd(U, 'goals')).resolves.toBeUndefined();
  });

  it('slips/PDF: 10 per month, then a friendly card; resets next month', async () => {
    for (let i = 0; i < 10; i++) await deps.plans.useDocument(U, TODAY);
    line.contents.set('img1', { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' });
    const msgs = await send({ ...textEvent(U, 'x'), message: { type: 'image', id: 'img1', contentProvider: { type: 'line' } } });
    expect(alt(msgs)).toContain('อ่านสลิป/PDF ครบ 10 ครั้ง');
    await expect(deps.plans.useDocument(U, '2026-12-01')).resolves.toBeUndefined();
  });

  it('AI: 20 per month on Free, then rules only (no AI call, no nagging)', async () => {
    for (let i = 0; i < 20; i++) expect(await deps.plans.useAi(U, TODAY)).toBe(true);
    await say('อะไรนะ บลาๆ');
    expect(aiCalls).toBe(0);
    await grant('plus');
    await say('อะไรนะ บลาๆ');
    expect(aiCalls).toBe(1);
  });

  it('scheduled pushes (daily summary, bill reminders) are Plus; month-end stays free', async () => {
    const at21 = new Date('2026-11-18T21:00:00+07:00');
    deps = make(() => at21);
    await runScheduledJobs(deps, at21, ['daily_summary']);
    expect(line.pushes.filter((p) => p.to === U)).toHaveLength(0);
    await grant('plus');
    await runScheduledJobs(deps, new Date('2026-11-19T21:00:00+07:00'), ['daily_summary']);
    expect(line.pushes.filter((p) => p.to === U)).toHaveLength(1);
  });
});

describe('LIFF API', () => {
  const opts = { allowedOrigins: ['https://shiksheek.vercel.app'], verify: async () => ({ userId: U, name: null, expiresAt: Date.now() + 1e6 }) };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handleApiRequest(
      new Request(`https://x.supabase.co/functions/v1/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer t', origin: 'https://shiksheek.vercel.app' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      deps,
      opts,
    );
    return { status: res.status, data: await res.json() };
  };

  it('GET /plan and 402 on limits', async () => {
    await endTrial();
    const r = await call('GET', '/plan');
    expect(r.data).toMatchObject({ plan: 'free', limits: { fixedCosts: 3 }, usage: { fixedCosts: 0 }, prices: { plus: { monthly: 49 } } });
    await deps.finance.createGoal(U, { name: 'a', targetSatang: 100_000, monthlyReserveSatang: 0 });
    const g = await call('POST', '/goals', { name: 'b', target: '1000' });
    expect(g).toMatchObject({ status: 402, data: { error: 'plan_limit', feature: 'goals', limit: 1 } });
    expect((await call('GET', '/reports/month?k=2026-11')).status).toBe(200);
    expect((await call('GET', '/reports/month?k=2026-08')).data).toMatchObject({ error: 'plan_limit', feature: 'history' });
  });
});
