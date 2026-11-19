import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import { averageMonthlyExpense, currentStep, emergencyFundTarget, percentOf, savingsRateBp } from '../../src/domain/calculations/wealth.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const U = testUserId(0x3ea1);
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events;');
  line = new FakeLineClient();
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai: null, clock: () => NOW, log: silent });
  await deps.repos.users.ensure(U, 'ปาล์ม');
  await deps.repos.users.setOnboarding(U, 'done');
});

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
const all = (m: Message[]) => JSON.stringify(m);
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const button = (msgs: Message[], action: string) => {
  const m = new RegExp(`"data":"(a=${action}[^"]*)"`).exec(all(msgs));
  if (!m) throw new Error(`no ${action} in ${alt(msgs)}`);
  return m[1]!;
};
const add = (type: 'income' | 'expense', amountSatang: number, txnDate: string, categoryId = type === 'income' ? 'salary' : 'food') =>
  deps.repos.transactions.insert({ userId: U, type, amountSatang, categoryId, note: null, txnDate, source: 'chat' });

describe('wealth maths', () => {
  it('rates, averages, targets and steps', () => {
    expect(savingsRateBp(2_500_000, 500_000)).toBe(2000);
    expect(savingsRateBp(0, 500)).toBeNull();
    expect(averageMonthlyExpense([0, 1_200_000, 1_800_000])).toBe(1_500_000);
    expect(averageMonthlyExpense([0, 0])).toBeNull();
    expect(emergencyFundTarget(1_234_567)).toBe(3_800_000); // 37,037.01 → ฿38,000
    expect(percentOf(2_512_345, 20)).toBe(502_400); // whole baht, rounded down
    expect(currentStep({ emergencySaved: 0, emergencyTarget: 100, savingsRateBp: 3000, openGoals: 0 })).toBe(1);
    expect(currentStep({ emergencySaved: 100, emergencyTarget: 100, savingsRateBp: 1000, openGoals: 0 })).toBe(2);
    expect(currentStep({ emergencySaved: 100, emergencyTarget: 100, savingsRateBp: 2500, openGoals: 1 })).toBe(3);
    expect(currentStep({ emergencySaved: 100, emergencyTarget: 100, savingsRateBp: 2500, openGoals: 0 })).toBe(4);
  });
});

describe('เก็บก่อนใช้ (pay yourself first)', () => {
  it('income ≥ ฿3,000 offers 10/20/30%; 20% creates the emergency fund once, double taps never save twice', async () => {
    await add('expense', 1_000_000, '2026-10-10'); // history → avg ฿10,000/month
    await add('expense', 1_200_000, '2026-09-10');
    const msgs = await say('ได้เงินเดือน 25000');
    await tap(button(msgs, 'txn_confirm')).then((saved) => {
      expect(all(saved)).toContain('a=save_first');
      expect(all(saved)).toContain('เก็บ 20% · ฿5,000');
      return saved;
    });
    const saved = line.lastReply();
    const twenty = /"data":"(a=save_first&id=[^"]*&p=20)"/.exec(all(saved))![1]!;
    const r1 = await tap(twenty);
    expect(alt(r1)).toContain('เงินสำรองฉุกเฉิน');
    expect(alt(r1)).toContain('฿5,000');
    expect(alt(await tap(twenty))).toContain('ไม่เก็บซ้ำ');
    const goals = await deps.finance.goals(U);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ savedSatang: 500_000, goal: { name: 'เงินสำรองฉุกเฉิน', targetSatang: 3_300_000 } }); // 3 × ฿11,000
    const dash = await deps.finance.dashboard(U, '2026-11-18');
    expect(dash.totals.savingSatang).toBe(500_000); // savings leave spendable money
  });

  it('small income does not nag', async () => {
    const msgs = await say('ได้ค่าขนม 500');
    expect(all(await tap(button(msgs, 'txn_confirm')))).not.toContain('save_first');
  });

  it('saves into an existing unfinished goal instead of creating one (free plan stays within limits)', async () => {
    await db.sql.query(`update users set created_at = '2026-09-01T00:00:00Z' where line_user_id = $1`, [U]); // Free plan
    const g = await deps.finance.createGoal(U, { name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 0 });
    const inc = await add('income', 1_000_000, '2026-11-18');
    const r = await deps.wealth.saveFirst(U, inc.id, 10, '2026-11-18');
    expect(r).toMatchObject({ status: 'saved', goal: { id: g.id }, createdGoal: false });
  });
});

describe('month-end leftover sweep', () => {
  it('a finished period with money left offers a sweep; it saves on the last day of that period, once', async () => {
    await add('income', 1_000_000, '2026-10-01');
    await add('expense', 600_000, '2026-10-15');
    const msgs = await tap('a=report_monthly&k=2026-10');
    expect(all(msgs)).toContain('a=sweep&k=2026-10&f=all');
    const r = await tap('a=sweep&k=2026-10&f=all');
    expect(alt(r)).toContain('฿4,000');
    const saving = (await deps.repos.transactions.listByRange(U, '2026-10-01', '2026-10-31')).find((t) => t.type === 'saving')!;
    expect(saving).toMatchObject({ amountSatang: 400_000, txnDate: '2026-10-31' });
    expect(alt(await tap('a=sweep&k=2026-10&f=half'))).toContain('ไม่เก็บซ้ำ');
    expect(all(await say('สรุปเดือนที่แล้ว'))).not.toContain('a=sweep');
    // the current, unfinished period can never be swept
    expect((await deps.wealth.sweep(U, '2026-11', 'all', '2026-11-18')).status).toBe('nothing');
  });
});

describe('แผนการเงิน', () => {
  it('shows the savings rate and the 4-step ladder; works from chat and the rich menu action', async () => {
    await add('income', 2_000_000, '2026-11-01');
    await add('expense', 800_000, '2026-10-05');
    const msgs = await say('แผนการเงิน');
    expect(all(msgs)).toContain('บันไดการเงิน 4 ขั้น');
    expect(all(msgs)).toContain('a=wealth_emergency');
    expect(all(msgs)).toContain('ไม่ใช่คำแนะนำการลงทุน');
    const made = await tap('a=wealth_emergency');
    expect(alt(made)).toContain('฿24,000'); // 3 × ฿8,000
    expect(all(await tap('a=wealth_plan'))).toContain('a=goal_contribute');
  });

  it('"สแกนสลิป" offers camera and photo-picker shortcuts', async () => {
    const msgs = await say('สแกนสลิป');
    expect(all(msgs)).toContain('"type":"camera"');
    expect(all(msgs)).toContain('"type":"cameraRoll"');
    expect(all(await tap('a=add_expense'))).toContain('"type":"camera"');
  });
});
