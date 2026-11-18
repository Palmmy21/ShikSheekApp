import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { AiClient, DocExtraction } from '../../src/infrastructure/ai/claude.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, nextEventId, postbackEvent, signedBody } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
let nextExtraction: DocExtraction | null;
const U = testUserId(0xd0c);
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const LOCKED_PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<</Encrypt 5 0 R>>\n%%EOF');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const fakeAi: AiClient = { interpret: async () => null, phrase: async () => null, extractDocument: async () => nextExtraction };

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events;');
  line = new FakeLineClient();
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai: fakeAi, clock: () => NOW, log: silent });
  await deps.repos.users.ensure(U);
  nextExtraction = null;
});

function mediaEvent(message: Record<string, unknown>) {
  const id = nextEventId();
  return { type: 'message', mode: 'active', timestamp: 1, source: { type: 'user', userId: U }, webhookEventId: id, deliveryContext: { isRedelivery: false }, replyToken: `rt-${id}`, message };
}

async function send(event: unknown): Promise<Message[]> {
  line.reset();
  const { body, signature } = await signedBody([event]);
  await (await handleWebhookRequest(body, signature, CHANNEL_SECRET, deps)).work;
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  return msgs;
}
const sendImage = (id: string) => send(mediaEvent({ type: 'image', id, contentProvider: { type: 'line' } }));
const sendPdf = (id: string, fileName = 'statement.pdf') => send(mediaEvent({ type: 'file', id, fileName, fileSize: 100 }));
const tap = (data: string) => send(postbackEvent(U, data));
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
const button = (msgs: Message[], action: string) => {
  const m = new RegExp(`"data":"(a=${action}[^"]*)"`).exec(JSON.stringify(msgs));
  if (!m) throw new Error(`no ${action} in ${alt(msgs)}`);
  return m[1]!;
};

const slip = (reference: string | null = '014312345678ABC'): DocExtraction => ({
  kind: 'transfer_slip',
  rows: [{ type: 'expense', amount_text: '1,250.00', date: '2026-11-17', description: 'ร้านกาแฟดอยช้าง', category_id: 'food', reference }],
});

describe('slip images', () => {
  it('slip → confirmation card → confirm saves once with the slip reference', async () => {
    line.contents.set('img1', { bytes: JPEG, contentType: 'image/jpeg' });
    nextExtraction = slip();
    let msgs = await sendImage('img1');
    expect(alt(msgs)).toContain('ยืนยันรายจ่าย ฿1,250');
    expect(await deps.repos.transactions.countLive(U)).toBe(0); // nothing saved yet

    msgs = await tap(button(msgs, 'txn_confirm'));
    const [t] = await deps.repos.transactions.listRecent(U, 1);
    expect(t).toMatchObject({ amountSatang: 125_000, txnDate: '2026-11-17', source: 'slip', externalRef: 'ref:014312345678ABC', categoryId: 'food' });
  });

  it('sending the same slip again is recognised and not recorded twice', async () => {
    line.contents.set('img1', { bytes: JPEG, contentType: 'image/jpeg' });
    nextExtraction = slip();
    await tap(button(await sendImage('img1'), 'txn_confirm'));
    const again = await sendImage('img1');
    expect(alt(again)).toContain('จดไปแล้ว');
    expect(await deps.repos.transactions.countLive(U)).toBe(1);
  });

  it('two pending cards for the same slip cannot both be confirmed', async () => {
    line.contents.set('a', { bytes: JPEG, contentType: 'image/jpeg' });
    nextExtraction = slip();
    await tap(button(await sendImage('a'), 'txn_confirm'));
    // a second draft carrying the same reference (e.g. created before the first was confirmed)
    const second = await deps.repos.pending.create(U, 'transaction', { type: 'expense', amountSatang: 125_000, categoryId: 'food', categoryConfident: true, note: null, txnDate: '2026-11-17', source: 'slip', externalRef: 'ref:014312345678ABC' }, 60);
    expect((await deps.txns.confirm(U, second.id, '2026-11-18')).status).toBe('duplicate');
    // the database index is the final backstop even if the pre-check were bypassed
    await expect(
      db.sql.query(`insert into transactions (user_id, type, amount_satang, category_id, txn_date, source, external_ref) values ($1, 'expense', 1, 'food', '2026-11-17', 'slip', 'ref:014312345678ABC')`, [U]),
    ).rejects.toThrow(/transactions_one_per_external_ref/);
    expect(await deps.repos.transactions.countLive(U)).toBe(1);
  });

  it('direction can be switched to income before confirming', async () => {
    line.contents.set('img2', { bytes: JPEG, contentType: 'image/jpeg' });
    nextExtraction = slip(null);
    let msgs = await sendImage('img2');
    msgs = await tap(button(msgs, 'txn_set_type'));
    expect(alt(msgs)).toContain('ยืนยันรายรับ');
    await tap(button(msgs, 'txn_confirm'));
    const [t] = await deps.repos.transactions.listRecent(U, 1);
    expect(t).toMatchObject({ type: 'income', categoryId: 'other_income' });
  });

  it('non-financial photos and AI failures get a friendly reply and save nothing', async () => {
    line.contents.set('cat', { bytes: JPEG, contentType: 'image/jpeg' });
    nextExtraction = { kind: 'not_financial', rows: [] };
    expect(alt(await sendImage('cat'))).toContain('ไม่เจอรายการเงิน');
    nextExtraction = null;
    expect(alt(await sendImage('cat'))).toContain('ไม่สำเร็จ');
    expect(await deps.repos.transactions.countLive(U)).toBe(0);
  });

  it('without AI configured the bot explains instead of failing', async () => {
    deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line, ai: null, clock: () => NOW, log: silent });
    line.contents.set('img', { bytes: JPEG, contentType: 'image/jpeg' });
    expect(alt(await sendImage('img'))).toContain('ยังไม่ได้เปิด');
  });
});

describe('PDF statements', () => {
  const statement: DocExtraction = {
    kind: 'statement',
    rows: [
      { type: 'income', amount_text: '25,000.00', date: '2026-11-01', description: 'เงินเดือน', category_id: 'salary', reference: null },
      { type: 'expense', amount_text: '-65.00', date: '2026-11-02', description: 'ข้าวมันไก่', category_id: 'food', reference: null },
      { type: 'expense', amount_text: '-65.00', date: '2026-11-02', description: 'ข้าวมันไก่', category_id: 'food', reference: null },
      { type: 'expense', amount_text: '-500.00', date: '2026-11-03', description: 'PTT', category_id: 'transport', reference: null },
      { type: 'expense', amount_text: 'ยอดยกมา', date: null, description: 'balance', category_id: null, reference: null },
    ],
  };

  it('statement → summary → import all atomically; re-import adds nothing', async () => {
    line.contents.set('pdf1', { bytes: PDF, contentType: 'application/pdf' });
    nextExtraction = statement;
    let msgs = await sendPdf('pdf1');
    expect(alt(msgs)).toContain('พบ 4 รายการ');
    expect(JSON.stringify(msgs)).toContain('฿630'); // 65 + 65 + 500 pre-summed by the service
    msgs = await tap(button(msgs, 'import_confirm'));
    expect(alt(msgs)).toContain('นำเข้าแล้ว 4 รายการ');
    expect(await deps.repos.transactions.countLive(U)).toBe(4);

    const again = await sendPdf('pdf1');
    expect(alt(again)).toContain('จดไว้แล้ว');
    expect(await deps.repos.transactions.countLive(U)).toBe(4);
    const d = await deps.finance.dashboard(U, '2026-11-18');
    expect(d.available.incomeSatang).toBe(2_500_000);
    expect(d.available.expenseSatang).toBe(63_000);
  });

  it('double-tapping import imports once', async () => {
    line.contents.set('pdf1', { bytes: PDF, contentType: 'application/pdf' });
    nextExtraction = statement;
    const confirm = button(await sendPdf('pdf1'), 'import_confirm');
    await tap(confirm);
    expect(alt(await tap(confirm))).toContain('หมดอายุ');
    expect(await deps.repos.transactions.countLive(U)).toBe(4);
  });

  it('password-protected and fake PDFs are rejected before calling the AI', async () => {
    let called = false;
    deps.ai = { ...fakeAi, extractDocument: async () => ((called = true), statement) };
    line.contents.set('locked', { bytes: LOCKED_PDF, contentType: 'application/pdf' });
    line.contents.set('fake', { bytes: JPEG, contentType: 'application/pdf' });
    expect(alt(await sendPdf('locked'))).toContain('รหัสผ่าน');
    expect(alt(await sendPdf('fake'))).toContain('ไม่ใช่ PDF');
    expect(called).toBe(false);
  });

  it('a single-receipt PDF uses the normal confirmation card', async () => {
    line.contents.set('r', { bytes: PDF, contentType: 'application/pdf' });
    nextExtraction = { kind: 'receipt', rows: [{ type: 'expense', amount_text: '359.00', date: '2026-11-18', description: 'Lazada', category_id: 'shopping', reference: null }] };
    const msgs = await sendPdf('r', 'receipt.pdf');
    expect(alt(msgs)).toContain('ยืนยันรายจ่าย ฿359');
  });
});

describe('other media', () => {
  it('voice messages get a dictation hint; unknown files a format hint', async () => {
    expect(alt(await send(mediaEvent({ type: 'audio', id: 'a1', duration: 3000 })))).toContain('ไมค์');
    expect(alt(await send(mediaEvent({ type: 'file', id: 'f1', fileName: 'note.docx', fileSize: 10 })))).toContain('PDF');
  });
});
