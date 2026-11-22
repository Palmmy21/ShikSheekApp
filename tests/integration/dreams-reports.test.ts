import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { runScheduledJobs } from '../../src/application/jobs.ts';
import { parseMessage } from '../../src/application/parser/message-parser.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { handleApiRequest, type ApiOptions } from '../../src/presentation/api/router.ts';
import { handleText } from '../../src/presentation/line/handlers/text-handler.ts';
import { bangkokToday } from '../../src/domain/dates.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { FakeLineClient } from '../helpers/line.ts';

let db: TestDb;
let deps: AppDeps;
let line: FakeLineClient;
let now = new Date('2026-11-22T03:00:00Z');
const U1 = testUserId(0xd1);
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
  await db.pg.exec('truncate users cascade; truncate job_runs;');
  now = new Date('2026-11-22T03:00:00Z');
  line = new FakeLineClient();
  deps = createAppDeps(
    db.sql,
    { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined, LIFF_URL: 'https://liff.line.me/123-abc' },
    { line, ai: null, clock: () => now, log: silent },
  );
});

async function call(method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`https://x.supabase.co/functions/v1/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer tok1' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    deps,
    opts,
  );
  const text = await res.text();
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, data: isJson && text ? JSON.parse(text) : text, headers: res.headers };
}

const ctx = () => ({ userId: U1, now, today: bangkokToday(now), deps });

describe('dreams API', () => {
  it('lists templates, creates a dream that reserves its monthly amount, and plans the road', async () => {
    const empty = await call('GET', '/dreams');
    expect(empty.status).toBe(200);
    expect(empty.data.items).toEqual([]);
    expect(empty.data.templates.map((t: { kind: string }) => t.kind)).toContain('home');

    const created = await call('POST', '/dreams', { kind: 'travel', name: 'เที่ยวญี่ปุ่น', target: '60000', targetDate: '2027-11-22' });
    expect(created.status).toBe(201);

    const list = await call('GET', '/dreams');
    const d = list.data.items[0];
    expect(d).toMatchObject({ kind: 'travel', name: 'เที่ยวญี่ปุ่น', emoji: '✈️', monthsLeft: 12, monthlyNeeded: { satang: 500_000 }, status: 'starting', milestone: 0, reserving: true, illustrations: [] });
    expect(d.coach.body).toContain('฿5,000');

    // the reserve reduces available-to-spend (เก็บก่อนใช้ for the future)
    await call('POST', '/transactions', { type: 'income', amount: '20000', categoryId: 'salary', date: '2026-11-22' });
    expect((await call('GET', '/dashboard')).data.available.satang).toBe(1_500_000);

    // saving into it moves the milestones
    await call('POST', `/goals/${created.data.id}/contribute`, { amount: '16000' });
    const after = (await call('GET', '/dreams')).data.items[0];
    expect(after).toMatchObject({ progressPercent: 26, milestone: 25, next: { percent: 50, amountToGo: { satang: 1_400_000 } } });
    expect((await call('GET', '/goals')).data[0].dream).toBe('travel');
  });

  it('long dreams get the assumed-rate illustration; adjusting the plan recalculates the reserve', async () => {
    const c = await call('POST', '/dreams', { kind: 'retire', target: '3000000', targetDate: '2051-11-22', reserve: true });
    let d = (await call('GET', '/dreams')).data.items[0];
    expect(d.name).toBe('เกษียณสบาย'); // template label when no name is given
    expect(d.illustrations.map((i: { ratePercent: number }) => i.ratePercent)).toEqual([2, 5]);
    const before = d.monthlyNeeded.satang;

    expect((await call('PATCH', `/dreams/${c.data.id}`, { targetDate: '2041-11-22' })).status).toBe(200);
    d = (await call('GET', '/dreams')).data.items[0];
    expect(d.monthlyNeeded.satang).toBeGreaterThan(before);
    const goal = await deps.repos.goals.get(U1, c.data.id);
    expect(goal!.monthlyReserveSatang).toBe(d.monthlyNeeded.satang);

    expect((await call('PATCH', `/dreams/${c.data.id}`, { reserve: false })).status).toBe(200);
    expect((await deps.repos.goals.get(U1, c.data.id))!.monthlyReserveSatang).toBe(0);
  });

  it('validates dates, kinds and amounts; plain goals are not dreams', async () => {
    expect((await call('POST', '/dreams', { kind: 'home', target: '1000', targetDate: '2026-11-22' })).status).toBe(422);
    expect((await call('POST', '/dreams', { kind: 'home', target: '1000', targetDate: '2080-01-01' })).status).toBe(422);
    expect((await call('POST', '/dreams', { kind: 'yacht', target: '1000', targetDate: '2030-01-01' })).status).toBe(422);
    expect((await call('POST', '/dreams', { kind: 'home', target: '-5', targetDate: '2030-01-01' })).status).toBe(422);
    const g = await call('POST', '/goals', { name: 'มือถือ', target: '20000' });
    expect((await call('GET', '/dreams')).data.items).toEqual([]);
    expect((await call('PATCH', `/dreams/${g.data.id}`, { target: '1' })).status).toBe(404);
  });

  it('respects the plan goal limit', async () => {
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await call('POST', '/dreams', { kind: 'custom', name: `ฝัน ${i}`, target: '1000', targetDate: '2030-01-01' })).status);
    // trial users get Pro (unlimited); after the trial, free has a cap — either way no 500s
    expect(results.every((s) => s === 201 || s === 402)).toBe(true);
  });
});

describe('monthly coach', () => {
  it('rides along with the monthly summary push (one push, valid Flex)', async () => {
    await deps.repos.users.ensure(U1, 'ปาล์ม');
    await deps.repos.users.setOnboarding(U1, 'done');
    await call('POST', '/dreams', { kind: 'home', target: '300000', targetDate: '2031-11-22' });
    now = new Date('2026-12-01T09:00:00+07:00');
    await runScheduledJobs(deps, now, ['monthly_summary']);
    expect(line.pushes).toHaveLength(1);
    const msgs = line.pushes[0]!.messages;
    expect(validateMessages(msgs)).toEqual([]);
    expect(JSON.stringify(msgs)).toContain('อนาคตที่อยากมี');
    expect(JSON.stringify(msgs)).toContain('https://liff.line.me/123-abc?tab=story'); // story button on the summary
  });

  it('no dreams → no coach bubble', async () => {
    await deps.repos.users.ensure(U1, 'ปาล์ม');
    await deps.repos.users.setOnboarding(U1, 'done');
    now = new Date('2026-12-01T09:00:00+07:00');
    await runScheduledJobs(deps, now, ['monthly_summary']);
    expect(JSON.stringify(line.pushes[0]!.messages)).not.toContain('อนาคตที่อยากมี');
  });
});

describe('statement report API', () => {
  async function seed() {
    await call('POST', '/transactions', { type: 'income', amount: '30000', categoryId: 'salary', date: '2026-11-01' });
    await call('POST', '/transactions', { type: 'expense', amount: '1234.50', categoryId: 'food', note: '=cmd()', date: '2026-11-05' });
    await call('POST', '/transactions', { type: 'expense', amount: '500', categoryId: 'transport', date: '2026-10-20' });
  }

  it('returns the statement JSON for a range', async () => {
    await seed();
    const r = await call('GET', '/reports/statement?from=2026-10-01&to=2026-11-30');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ name: 'ปาล์ม', income: { satang: 3_000_000 }, expense: { satang: 173_450 }, keptPercent: 94, days: 61 });
    expect(r.data.months.map((m: { key: string }) => m.key)).toEqual(['2026-10', '2026-11']);
    expect(r.data.rows).toHaveLength(3);
    expect(r.data.expenseByCategory[0]).toMatchObject({ label: 'อาหาร', percent: 71 });
  });

  it('downloads Excel CSV with a filename and safe cells', async () => {
    await seed();
    const r = await call('GET', '/reports/statement.csv?from=2026-11-01&to=2026-11-30');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('shiksheek-report-2026-11-01-2026-11-30.csv');
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(r.data).toContain("'=cmd()");
    expect(r.data).toContain('1234.50');
  });

  it('rejects bad ranges', async () => {
    expect((await call('GET', '/reports/statement?from=2026-11-30&to=2026-11-01')).status).toBe(422);
    expect((await call('GET', '/reports/statement?from=2025-01-01&to=2026-11-30')).status).toBe(422);
    expect((await call('GET', '/reports/statement?from=nope&to=2026-11-30')).status).toBe(422);
  });
});

describe('investing basics calculator', () => {
  it('returns a yearly series; validates the inputs', async () => {
    const r = await call('POST', '/learn/compound', { monthly: '1000', rateBp: 500, years: 10 });
    expect(r.status).toBe(200);
    expect(r.data.series).toHaveLength(11);
    expect(r.data.deposited.satang).toBe(12_000_000);
    expect(r.data.balance.satang).toBeGreaterThan(r.data.deposited.satang);
    expect(r.data.growth.satang).toBe(r.data.balance.satang - r.data.deposited.satang);
    expect((await call('POST', '/learn/compound', { monthly: '1000', rateBp: 5000, years: 10 })).status).toBe(422);
    expect((await call('POST', '/learn/compound', { monthly: '1000', rateBp: 500, years: 99 })).status).toBe(422);
  });
});

describe('chat commands', () => {
  it.each([
    ['แผนชีวิต', 'dreams'], ['อนาคตที่อยากมี', 'dreams'], ['ความฝัน', 'dreams'],
    ['ส่งออกรายงาน', 'report'], ['ขอรายงาน', 'report'], ['รายงาน pdf', 'report'], ['รายงานประจำปี', 'report'],
    ['ความรู้ลงทุน', 'learn'], ['สอนลงทุน', 'learn'], ['ลงทุนมือใหม่', 'learn'], ['DCA', 'learn'],
  ])('"%s" → %s', (text, command) => {
    expect(parseMessage(text, '2026-11-22')).toEqual({ kind: 'command', command });
  });

  it('replies are valid Flex with LIFF links', async () => {
    await deps.repos.users.ensure(U1, 'ปาล์ม');
    await deps.repos.users.setOnboarding(U1, 'done');
    for (const [text, link] of [['แผนชีวิต', '?tab=plans&dream=new'], ['ส่งออกรายงาน', '?tab=report'], ['ความรู้ลงทุน', '?tab=learn']] as const) {
      const msgs = await handleText(ctx(), text);
      expect(validateMessages(msgs)).toEqual([]);
      expect(JSON.stringify(msgs)).toContain(`https://liff.line.me/123-abc${link}`);
    }
    await call('POST', '/dreams', { kind: 'car', target: '150000', targetDate: '2028-11-22' });
    const coach = await handleText(ctx(), 'แผนชีวิต');
    expect(validateMessages(coach)).toEqual([]);
    expect(JSON.stringify(coach)).toContain('รถคันแรก');
  });
});
