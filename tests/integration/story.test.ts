import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handleApiRequest, type ApiOptions } from '../../src/presentation/api/router.ts';
import { parseMessage } from '../../src/application/parser/message-parser.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { FakeLineClient } from '../helpers/line.ts';

let db: TestDb;
let deps: AppDeps;
let now = new Date('2026-11-18T03:00:00Z');
const U1 = testUserId(0x5701);
const ORIGIN = 'https://shiksheek.vercel.app';
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const opts: ApiOptions = {
  allowedOrigins: [ORIGIN],
  verify: async (t) => (t === 'tok1' ? { userId: U1, name: 'ปาล์ม', expiresAt: Date.now() + 1e6 } : null),
};

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade;');
  now = new Date('2026-11-18T03:00:00Z');
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line: new FakeLineClient(), ai: null, clock: () => now, log: silent });
});

async function call(method: string, path: string, body?: unknown, token = 'tok1') {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handleApiRequest(
    new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    deps,
    opts,
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function record(userId: string, type: 'income' | 'expense', amountSatang: number, txnDate: string, categoryId = type === 'income' ? 'salary' : 'food') {
  await deps.repos.transactions.insert({ userId, type, amountSatang, categoryId, note: null, txnDate, source: 'chat' });
}

describe('GET /story', () => {
  it('requires auth', async () => {
    expect((await call('GET', '/story', undefined, '')).status).toBe(401);
  });

  it('builds the current month so far, with referral code, never exposing income', async () => {
    await call('GET', '/me'); // creates the user
    await record(U1, 'income', 4_000_000, '2026-11-01');
    await record(U1, 'expense', 800_000, '2026-11-05');
    await record(U1, 'expense', 200_000, '2026-11-10', 'transport');
    await record(U1, 'expense', 999_999, '2026-12-01'); // outside the period, ignored

    const r = await call('GET', '/story');
    expect(r.status).toBe(200);
    expect(r.data.period).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(r.data.persona.id).toBe('golden'); // kept 30,000 of 40,000
    const recap = r.data.cards[0];
    expect(recap).toMatchObject({ kind: 'recap', eyebrow: 'เดือนนี้ของ ปาล์ม · พ.ย. 2569', hero: { label: 'เก็บได้แล้ว', value: '฿30,000', private: true } });
    expect(recap.badge).toBeNull(); // cohort of 1 is too small
    expect(r.data.invite.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(r.data.invite.code).toBe((await call('GET', '/referral')).data.code);
    expect(JSON.stringify(r.data)).not.toContain('40,000');
  });

  it('early in a cycle it recaps the finished previous month', async () => {
    await call('GET', '/me');
    await record(U1, 'income', 1_000_000, '2026-11-02');
    await record(U1, 'expense', 100_000, '2026-11-03');
    await record(U1, 'expense', 100_000, '2026-11-04');
    now = new Date('2026-12-03T03:00:00Z');
    const r = await call('GET', '/story');
    expect(r.data.period).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(r.data.cards[0].eyebrow).toBe('สรุปเดือนของ ปาล์ม · พ.ย. 2569');
    expect(r.data.cards[0].hero.label).toBe('เดือนนี้เก็บได้');
  });

  it('shows the anonymous percentile once the cohort is big enough', async () => {
    await call('GET', '/me');
    await record(U1, 'income', 1_000_000, '2026-11-01');
    await record(U1, 'expense', 200_000, '2026-11-02'); // 80% kept
    await record(U1, 'expense', 100_000, '2026-11-03'); // → 70%
    await record(U1, 'expense', 100_000, '2026-11-04'); // → 60%
    // 24 other users who keep 0% … 46% (all below 60%), plus 1 who keeps 90%
    for (let i = 0; i < 25; i++) {
      const id = testUserId(0x9000 + i);
      await deps.repos.users.ensure(id, null);
      await record(id, 'income', 1_000_000, '2026-11-01');
      const keptPct = i === 24 ? 90 : i * 2;
      if (keptPct < 100) await record(id, 'expense', 1_000_000 - keptPct * 10_000, '2026-11-02');
    }
    const r = await call('GET', '/story');
    // 24 of 26 users (incl. self) are strictly below → 92%
    expect(r.data.cards[0].badge).toBe('ออมเก่งกว่า 92% ของผู้ใช้ชิกชิก');
  });

  it('adds streak and goal cards when earned', async () => {
    await call('GET', '/me');
    // a streak needs entries recorded on consecutive days (by created_at)
    for (let d = 0; d < 4; d++) {
      await db.pg.query(
        `insert into transactions (user_id, type, amount_satang, category_id, txn_date, created_at) values ($1, 'expense', 5000, 'food', '2026-11-15', now() - make_interval(days => $2))`,
        [U1, d],
      );
    }
    const g = await call('POST', '/goals', { name: 'เที่ยวญี่ปุ่น', target: '10000' });
    await call('POST', `/goals/${g.data.id}/contribute`, { amount: '2500' });
    const r = await call('GET', '/story');
    expect(r.data.cards.map((c: { kind: string }) => c.kind)).toEqual(['recap', 'streak', 'goal']);
    expect(r.data.cards[1].hero.value).toBe('4 วัน');
    expect(r.data.cards[2]).toMatchObject({ title: 'ไปแล้ว 25%', hero: { value: 'เที่ยวญี่ปุ่น', private: true } });
  });
});

describe('POST /story/shared', () => {
  it('records shares and validates input', async () => {
    expect((await call('POST', '/story/shared', { card: 'recap', method: 'share' })).status).toBe(200);
    expect((await call('POST', '/story/shared', { card: 'goal', method: 'download' })).status).toBe(200);
    expect((await call('POST', '/story/shared', { card: 'salary', method: 'share' })).status).toBe(422);
    expect((await call('POST', '/story/shared', { card: 'recap', method: 'tiktok' })).status).toBe(422);
    expect(await deps.repos.engagement.storyShareCount(U1)).toBe(2);
  });

  it('share history is deleted with the account', async () => {
    await call('POST', '/story/shared', { card: 'recap', method: 'share' });
    await deps.repos.users.deleteCompletely(U1);
    expect(await deps.repos.engagement.storyShareCount(U1)).toBe(0);
  });
});

describe('chat command', () => {
  it.each(['แชร์สตอรี่', 'แชร์ลงไอจี', 'ลงสตอรี่', 'การ์ดสตอรี่', 'สรุปลงไอจี', 'story', 'Wrapped'])('"%s" opens the story studio', (text) => {
    expect(parseMessage(text, '2026-11-18')).toEqual({ kind: 'command', command: 'story' });
  });
});
