import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { createIdTokenVerifier } from '../../src/infrastructure/line/id-token.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handleApiRequest, type ApiOptions } from '../../src/presentation/api/router.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { FakeLineClient } from '../helpers/line.ts';

let db: TestDb;
let deps: AppDeps;
const U1 = testUserId(0xa11);
const U2 = testUserId(0xb22);
const ORIGIN = 'https://shiksheek.vercel.app';
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const opts: ApiOptions = {
  allowedOrigins: [ORIGIN],
  verify: async (t) => (t === 'tok1' ? { userId: U1, name: 'ปาล์ม', expiresAt: Date.now() + 1e6 } : t === 'tok2' ? { userId: U2, name: null, expiresAt: Date.now() + 1e6 } : null),
};

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade;');
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined }, { line: new FakeLineClient(), ai: null, clock: () => new Date('2026-11-18T03:00:00Z'), log: silent });
});

async function call(method: string, path: string, body?: unknown, token = 'tok1', origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const res = await handleApiRequest(
    new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    deps,
    opts,
  );
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

describe('API auth & CORS', () => {
  it('rejects missing/invalid tokens and foreign origins', async () => {
    expect((await call('GET', '/me', undefined, '')).status).toBe(401);
    expect((await call('GET', '/me', undefined, 'forged')).status).toBe(401);
    expect((await call('GET', '/me', undefined, 'tok1', 'https://evil.example')).status).toBe(403);
  });

  it('answers preflight with the allowed origin only', async () => {
    const r = await handleApiRequest(new Request('https://x/functions/v1/api/me', { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps, opts);
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('creates the user on first call and returns the profile', async () => {
    const r = await call('GET', '/me');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ displayName: 'ปาล์ม', cycleStartDay: 1, today: '2026-11-18' });
  });
});

describe('transactions', () => {
  it('create, list, edit, delete and restore with exact amounts', async () => {
    const created = await call('POST', '/transactions', { type: 'expense', amount: '1,234.50', categoryId: 'food', note: 'ข้าวมันไก่', date: '2026-11-18' });
    expect(created.status).toBe(201);
    expect(created.data.amount).toEqual({ satang: 123_450, text: '฿1,234.50' });
    expect(created.data.source).toBe('liff');

    const list = await call('GET', '/transactions?q=มันไก่');
    expect(list.data.items).toHaveLength(1);

    const id = created.data.id as string;
    const edited = await call('PATCH', `/transactions/${id}`, { amount: '99', categoryId: 'transport' });
    expect(edited.data).toMatchObject({ amount: { satang: 9_900 }, category: { id: 'transport' } });

    expect((await call('DELETE', `/transactions/${id}`)).status).toBe(200);
    expect((await call('GET', '/transactions')).data.items).toHaveLength(0);
    expect((await call('POST', `/transactions/${id}/restore`)).status).toBe(200);
  });

  it('validates input (bad amounts, wrong-kind category, dates out of range)', async () => {
    expect((await call('POST', '/transactions', { type: 'expense', amount: '0', categoryId: 'food', date: '2026-11-18' })).status).toBe(422);
    expect((await call('POST', '/transactions', { type: 'expense', amount: '1.234', categoryId: 'food', date: '2026-11-18' })).status).toBe(422);
    expect((await call('POST', '/transactions', { type: 'expense', amount: '50', categoryId: 'salary', date: '2026-11-18' })).status).toBe(422);
    expect((await call('POST', '/transactions', { type: 'expense', amount: '50', categoryId: 'food', date: '2024-01-01' })).status).toBe(422);
  });

  it("a user cannot see, edit or delete another user's transactions", async () => {
    const t = await call('POST', '/transactions', { type: 'expense', amount: '50', categoryId: 'food', date: '2026-11-18' });
    expect((await call('GET', '/transactions', undefined, 'tok2')).data.items).toHaveLength(0);
    expect((await call('PATCH', `/transactions/${t.data.id}`, { amount: '1' }, 'tok2')).status).toBe(404);
    expect((await call('DELETE', `/transactions/${t.data.id}`, undefined, 'tok2')).status).toBe(404);
    expect((await call('GET', '/transactions')).data.items[0].amount.satang).toBe(5_000);
  });
});

describe('dashboard, bills, budgets, goals, reports, settings', () => {
  it('end-to-end money picture stays consistent', async () => {
    await call('POST', '/transactions', { type: 'income', amount: '25000', categoryId: 'salary', date: '2026-11-01' });
    await call('POST', '/transactions', { type: 'expense', amount: '65', categoryId: 'food', date: '2026-11-18' });
    const fcRes = await call('POST', '/fixed-costs', { name: 'ค่าห้อง', amount: '6500', frequency: 'monthly', firstDueDate: '2026-11-25' });
    expect(fcRes.status).toBe(201);

    let dash = (await call('GET', '/dashboard')).data;
    expect(dash.available.satang).toBe(2_500_000 - 6_500 - 650_000);
    expect(dash.upcomingBills[0]).toMatchObject({ name: 'ค่าห้อง', dueDate: '2026-11-25' });

    const occ = dash.upcomingBills[0].occurrenceId as string;
    expect((await call('POST', `/occurrences/${occ}/pay`, {})).status).toBe(200);
    expect((await call('POST', `/occurrences/${occ}/pay`, {})).status).toBe(409); // never twice
    dash = (await call('GET', '/dashboard')).data;
    expect(dash.available.satang).toBe(2_500_000 - 6_500 - 650_000); // unchanged: moved from unpaid to spent
    expect(dash.unpaidBills.satang).toBe(0);

    expect((await call('PUT', '/budgets/food', { limit: '100' })).status).toBe(200);
    const budgets = (await call('GET', '/budgets')).data.items;
    expect(budgets[0]).toMatchObject({ percent: 65, level: 'ok' });

    const g = await call('POST', '/goals', { name: 'เที่ยวญี่ปุ่น', target: '30000', monthlyReserve: '3000' });
    await call('POST', `/goals/${g.data.id}/contribute`, { amount: '500' });
    expect((await call('GET', '/goals')).data[0]).toMatchObject({ saved: { satang: 50_000 }, progressPercent: 1 });

    const rep = (await call('GET', '/reports/month')).data;
    expect(rep.daily).toHaveLength(30);
    expect(rep.daily.find((d: { date: string }) => d.date === '2026-11-18').expense.satang).toBe(6_500 + 650_000); // rent paid today
    expect(rep.expense.satang).toBe(6_500 + 650_000);
  });

  it('settings patch updates cycle and notifications', async () => {
    const r = await call('PATCH', '/settings', { cycleStartDay: 25, notifications: { dailySummary: false } });
    expect(r.data).toMatchObject({ cycleStartDay: 25, notifications: { dailySummary: false, billReminders: true } });
    expect((await call('PATCH', '/settings', { cycleStartDay: 31 })).status).toBe(422);
  });

  it('unknown routes are 404', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
  });
});

describe('LIFF ID token verifier', () => {
  const sub = U1;
  const fakeFetch = (resp: object, status = 200) => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify(resp), { status });
    }) as unknown as typeof fetch;
    return { f, calls: () => calls };
  };
  const tok = 'aaa.bbb.ccc';

  it('accepts a valid token for our channel and caches it', async () => {
    const { f, calls } = fakeFetch({ sub, aud: '2012666543', exp: Math.floor(Date.now() / 1000) + 600, name: 'ปาล์ม' });
    const verify = createIdTokenVerifier('2012666543', f);
    expect((await verify(tok))?.userId).toBe(sub);
    await verify(tok);
    expect(calls()).toBe(1);
  });

  it('rejects other channels, expired tokens, LINE errors and malformed tokens', async () => {
    expect(await createIdTokenVerifier('2012666543', fakeFetch({ sub, aud: '999', exp: 9e9 }).f)(tok)).toBeNull();
    expect(await createIdTokenVerifier('2012666543', fakeFetch({ sub, aud: '2012666543', exp: 1 }).f)(tok)).toBeNull();
    expect(await createIdTokenVerifier('2012666543', fakeFetch({ error: 'invalid_request' }, 400).f)(tok)).toBeNull();
    expect(await createIdTokenVerifier('2012666543', fakeFetch({}).f)('not-a-jwt')).toBeNull();
  });
});
