import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { AiClient, AiIntent } from '../../src/infrastructure/ai/claude.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const U = testUserId(0x5a7);
const TODAY = '2026-11-18';
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const make = (ai: AiClient | null = null) =>
  createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai, clock: () => NOW, log: silent });

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events;');
  line = new FakeLineClient();
  deps = make();
  await deps.repos.users.ensure(U, 'ปาล์ม');
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
const all = (msgs: Message[]) => JSON.stringify(msgs);
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const button = (msgs: Message[], action: string) => {
  const m = new RegExp(`"data":"(a=${action}[^"]*)"`).exec(all(msgs));
  if (!m) throw new Error(`no ${action} in ${alt(msgs)}`);
  return m[1]!;
};
const bill = (name: string, amount: number, day = 25) =>
  deps.fixedCosts.create(U, { name, amountSatang: amount, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: `2026-11-${String(day).padStart(2, '0')}` } }, TODAY);

describe('changing a bill by name', () => {
  it('"ค่าห้อง เปลี่ยน 2000 3000" → confirm → bill and unpaid occurrences use the new amount', async () => {
    const fc = await bill('ค่าห้อง', 200_000);
    const msgs = await say('ค่าห้อง เปลี่ยน 2000 3000');
    expect(all(msgs)).toContain('฿2,000 → ฿3,000');
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.amountSatang).toBe(200_000); // nothing yet
    await tap(button(msgs, 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.amountSatang).toBe(300_000);
    const occ = await deps.repos.fixedCosts.listOccurrencesOfFixedCost(U, fc.id, 5);
    expect(occ.every((o) => o.amountSatang === 300_000)).toBe(true);
  });

  it('warns when the "old" amount the user typed does not match', async () => {
    await bill('ค่าห้อง', 250_000);
    expect(all(await say('ค่าห้อง เปลี่ยน 2000 3000'))).toContain('ตอนนี้ตั้งไว้ ฿2,500');
  });

  it('tolerates a missing prefix and a typo', async () => {
    const fc = await bill('ค่าห้อง', 200_000);
    await tap(button(await say('แก้ห้องเป็น 2800'), 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.amountSatang).toBe(280_000);
  });

  it('asks which one when several match, then applies to the picked one', async () => {
    await bill('ค่าเน็ตบ้าน', 59_900);
    const mobile = await bill('ค่าเน็ตมือถือ', 39_900);
    let msgs = await say('แก้ค่าเน็ตเป็น 499');
    expect(alt(msgs)).toContain('หมายถึงอันไหน');
    const pickMobile = new RegExp(`"label":"ค่าเน็ตมือถือ[^"]*","data":"(a=edit_pick[^"]*)"`).exec(all(msgs))![1]!;
    msgs = await tap(pickMobile);
    await tap(button(msgs, 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, mobile.id))!.amountSatang).toBe(49_900);
  });

  it('says so and offers the list when nothing matches', async () => {
    await bill('ค่าห้อง', 200_000);
    expect(alt(await say('แก้ประกันรถเป็น 100'))).toContain('ไม่เจอ');
  });

  it('change due day, pause, resume and delete by name', async () => {
    const fc = await bill('ค่าเน็ต', 59_900, 5);
    await tap(button(await say('ค่าเน็ตเปลี่ยนเป็นวันที่ 20'), 'edit_confirm'));
    const next = (await deps.repos.fixedCosts.listOccurrencesOfFixedCost(U, fc.id, 5)).filter((o) => o.status === 'pending').map((o) => o.dueDate).sort()[0];
    expect(next).toBe('2026-11-20');

    await tap(button(await say('หยุดค่าเน็ต'), 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.status).toBe('paused');
    await tap(button(await say('เริ่มค่าเน็ตใหม่'), 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.status).toBe('active');
    await tap(button(await say('ลบค่าเน็ต'), 'edit_confirm'));
    expect(await deps.repos.fixedCosts.get(U, fc.id)).toBeNull();
  });
});

describe('budgets, goals and past entries by name', () => {
  it('budget and goal edits', async () => {
    await deps.finance.setBudget(U, 'food', 600_000);
    await tap(button(await say('งบอาหารเปลี่ยนเป็น 5000'), 'edit_confirm'));
    expect((await deps.repos.budgets.list(U))[0]!.limitSatang).toBe(500_000);

    const g = await deps.finance.createGoal(U, { name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 0 });
    await tap(button(await say('เป้าญี่ปุ่นเปลี่ยนเป็น 40000'), 'edit_confirm'));
    await tap(button(await say('เป้าญี่ปุ่นเดือนละ 5000'), 'edit_confirm'));
    expect(await deps.repos.goals.get(U, g.id)).toMatchObject({ targetSatang: 4_000_000, monthlyReserveSatang: 500_000 });
  });

  it('"แก้กาแฟเป็น 90" edits the recent entry', async () => {
    await tap(button(await say('กาแฟ 80'), 'txn_confirm'));
    await tap(button(await say('แก้กาแฟเป็น 90'), 'edit_confirm'));
    expect((await deps.repos.transactions.listRecent(U, 1))[0]!.amountSatang).toBe(9_000);
  });
});

describe('expense that matches a bill', () => {
  it('"ค่าห้อง 2000" asks: pay the bill / normal expense / change bill amount', async () => {
    const fc = await bill('ค่าห้อง', 650_000);
    const msgs = await say('ค่าห้อง 2000');
    expect(alt(msgs)).toContain('ค่าห้อง ใช่ไหม');
    expect(all(msgs)).toContain('fc_pay_amount');
    expect(all(msgs)).toContain('edit_confirm'); // amount differs → offer to change the bill
    const pay = button(msgs, 'fc_pay_amount');
    await tap(pay);
    await tap(pay); // double tap
    const occ = (await deps.repos.fixedCosts.listOccurrencesOfFixedCost(U, fc.id, 5)).find((o) => o.dueDate === '2026-11-25')!;
    expect(occ.status).toBe('paid');
    const txns = await deps.repos.transactions.listRecent(U, 5);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ amountSatang: 200_000, fixedCostOccurrenceId: occ.id });
  });

  it('can still be recorded as a normal expense', async () => {
    await bill('ค่าห้อง', 650_000);
    await tap(button(await say('ค่าห้อง 2000'), 'txn_confirm'));
    expect((await deps.repos.transactions.listRecent(U, 1))[0]).toMatchObject({ amountSatang: 200_000, fixedCostOccurrenceId: null });
  });
});

describe('AI understands confusing edits, within guards', () => {
  const edit = (p: Partial<AiIntent>): AiIntent => ({
    kind: 'edit', type: null, amount_text: null, category_id: null, note: null, date_offset_days: null, query: null, reply: null,
    edit_action: 'set_amount', edit_scope: 'fixed_cost', target_name: 'ค่าห้อง', new_amount_text: '3500', old_amount_text: null, day_of_month: null, ...p,
  });

  it('a loose sentence becomes a confirm card for the right bill; the AI saw the item names', async () => {
    let seenContext = '';
    deps = make({ interpret: async (_t, ctx) => ((seenContext = ctx ?? ''), edit({})), phrase: async () => null, extractDocument: async () => null });
    const fc = await bill('ค่าห้อง', 300_000);
    const msgs = await say('ห้องขึ้นราคาละนะ เดือนหน้าเหลือ 3500 ละ');
    expect(seenContext).toContain('bill: ค่าห้อง');
    expect(all(msgs)).toContain('฿3,000 → ฿3,500');
    await tap(button(msgs, 'edit_confirm'));
    expect((await deps.repos.fixedCosts.get(U, fc.id))!.amountSatang).toBe(350_000);
  });

  it('an AI amount that is not in the text is rejected', async () => {
    deps = make({ interpret: async () => edit({ new_amount_text: '9999' }), phrase: async () => null, extractDocument: async () => null });
    await bill('ค่าห้อง', 300_000);
    const msgs = await say('ห้องขึ้นราคาละนะ เดือนหน้าเหลือ 3500 ละ');
    expect(all(msgs)).not.toContain('edit_confirm');
  });
});
