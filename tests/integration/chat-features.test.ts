import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { AiClient } from '../../src/infrastructure/ai/claude.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const U = testUserId(0xfea7);
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function makeDeps(ai: AiClient | null = null) {
  return createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai, clock: () => NOW, log: silent });
}

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events;');
  line = new FakeLineClient();
  deps = makeDeps();
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
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const button = (msgs: Message[], action: string) => {
  const m = new RegExp(`"data":"(a=${action}[^"]*)"`).exec(JSON.stringify(msgs));
  if (!m) throw new Error(`no ${action} in ${alt(msgs)}`);
  return m[1]!;
};
const count = () => deps.repos.transactions.countLive(U);

describe('several items in one message', () => {
  it('one card, one tap saves all atomically; double tap saves nothing more', async () => {
    let msgs = await say('ข้าว 50 กาแฟ 40\nเติมน้ำมัน 500');
    expect(alt(msgs)).toContain('จด 3 รายการนี้ใช่ไหม');
    expect(JSON.stringify(msgs)).toContain('฿590'); // total pre-summed in the view
    expect(await count()).toBe(0);
    const confirm = button(msgs, 'multi_confirm');
    msgs = await tap(confirm);
    expect(alt(msgs)).toContain('บันทึก 3 รายการแล้ว');
    await tap(confirm);
    expect(await count()).toBe(3);
  });

  it('undo removes the whole batch', async () => {
    let msgs = await tap(button(await say('ข้าว 50, กาแฟ 40'), 'multi_confirm'));
    msgs = await tap(button(msgs, 'multi_undo'));
    expect(alt(msgs)).toContain('ยกเลิก 2 รายการแล้ว');
    expect(await count()).toBe(0);
  });
});

describe('auto-record (no confirmation)', () => {
  it('toggle by chat; confident entries save immediately with a delete button', async () => {
    expect(alt(await say('เปิดจดอัตโนมัติ'))).toContain('เปิดจดอัตโนมัติแล้ว');
    const msgs = await say('กินข้าว 65');
    expect(alt(msgs)).toContain('บันทึกรายจ่าย ฿65 แล้ว');
    expect(await count()).toBe(1);
    await tap(button(msgs, 'txn_delete_confirm'));
    expect(await count()).toBe(0);
  });

  it('unsure entries still ask (never saved silently)', async () => {
    await deps.repos.users.setAutoRecord(U, true);
    const msgs = await say('ฟหกด 120');
    expect(alt(msgs)).toContain('ยืนยันรายจ่าย');
    expect(await count()).toBe(0);
  });

  it('multi-item messages save at once when every item is confident, with batch undo', async () => {
    await deps.repos.users.setAutoRecord(U, true);
    const msgs = await say('ข้าว 50 กาแฟ 40');
    expect(alt(msgs)).toContain('บันทึก 2 รายการแล้ว');
    expect(await count()).toBe(2);
    await tap(button(msgs, 'multi_undo'));
    expect(await count()).toBe(0);
  });

  it('future-dated entries still ask', async () => {
    await deps.repos.users.setAutoRecord(U, true);
    expect(alt(await say('ค่าห้อง 6500 พรุ่งนี้'))).toContain('ยืนยันรายจ่าย');
  });
});

describe('automatic categorisation', () => {
  it('learns from a correction and applies it next time', async () => {
    let msgs = await say('ร้านป้าแดง 80');
    expect(alt(msgs)).toContain('ยืนยันรายจ่าย');
    msgs = await tap(button(msgs, 'txn_pick_category[^"]*c=food'));
    await tap(button(msgs, 'txn_confirm'));

    msgs = await say('ร้านป้าแดง 95');
    const json = JSON.stringify(msgs);
    expect(json).toContain('อาหาร');
    expect(json).not.toContain('ไม่แน่ใจหมวด');
  });

  it('asks the AI for a category only when unsure, and validates it', async () => {
    let calls = 0;
    deps = makeDeps({ interpret: async () => ((calls++), { kind: 'transaction', type: 'expense', amount_text: '120', category_id: 'health', note: null, date_offset_days: 0, query: null, reply: null, edit_action: null, edit_scope: null, target_name: null, new_amount_text: null, old_amount_text: null, day_of_month: null }), phrase: async () => null, extractDocument: async () => null });
    const msgs = await say('ฟหกด 120');
    expect(JSON.stringify(msgs)).toContain('สุขภาพ');
    await say('กินข้าว 65'); // confident by rules → AI not called
    expect(calls).toBe(1);
  });
});

describe('everyday commands and questions', () => {
  it('delete / edit the last entry', async () => {
    await tap(button(await say('กาแฟ 80'), 'txn_confirm'));
    expect(alt(await say('แก้ล่าสุดเป็น 95'))).toContain('฿95');
    expect((await deps.repos.transactions.listRecent(U, 1))[0]!.amountSatang).toBe(9_500);
    await say('ลบรายการล่าสุด');
    expect(await count()).toBe(0);
  });

  it('set a budget by text', async () => {
    await say('ตั้งงบอาหาร 6000');
    const [b] = await deps.repos.budgets.list(U);
    expect(b).toMatchObject({ categoryId: 'food', limitSatang: 600_000 });
  });

  it('category spend, yesterday, today list', async () => {
    await tap(button(await say('ข้าว 50 เมื่อวาน'), 'txn_confirm'));
    await tap(button(await say('กาแฟ 40'), 'txn_confirm'));
    expect(alt(await say('ค่าอาหารเดือนนี้เท่าไหร่'))).toContain('฿90');
    expect(alt(await say('เมื่อวานใช้ไปเท่าไหร่'))).toContain('฿50');
    expect(alt(await say('วันนี้จดอะไรไปบ้าง'))).toContain('ประวัติ');
  });
});

describe('push notifications', () => {
  it('"ทดสอบแจ้งเตือน" sends a real push to the user', async () => {
    const msgs = await say('ทดสอบแจ้งเตือน');
    expect(alt(msgs)).toContain('ส่งแจ้งเตือนทดสอบแล้ว');
    expect(line.pushes).toHaveLength(1);
    expect(line.pushes[0]!.to).toBe(U);
    expect(validateMessages(line.pushes[0]!.messages)).toEqual([]);
  });

  it('explains quota errors instead of failing silently', async () => {
    line.push = async () => {
      throw Object.assign(new Error('LINE API failed with 429'), { status: 429 });
    };
    expect(alt(await say('ทดสอบแจ้งเตือน'))).toContain('โควตา');
  });
});
