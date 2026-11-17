import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { dueJobs, retryKeyFor, runScheduledJobs } from '../../src/application/jobs.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { FakeLineClient } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const U1 = testUserId(0x11);
const U2 = testUserId(0x22);
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const bkk = (local: string) => new Date(`${local}+07:00`);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  line = new FakeLineClient();
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/a', DATA_EXPORT_URL: undefined }, { line, log: silent });
  await deps.repos.users.ensure(U1);
  await deps.repos.users.ensure(U2);
  await deps.repos.users.setOnboarding(U1, 'done');
});

describe('job schedule (Asia/Bangkok)', () => {
  it('selects jobs by Bangkok hour, with catch-up windows', () => {
    expect(dueJobs(bkk('2026-11-18T08:05:00'))).toEqual(expect.arrayContaining(['bill_reminders', 'generate_occurrences']));
    expect(dueJobs(bkk('2026-11-18T21:00:00'))).toContain('daily_summary');
    expect(dueJobs(bkk('2026-11-18T23:59:00'))).toContain('daily_summary'); // catch-up
    expect(dueJobs(bkk('2026-11-19T00:30:00'))).not.toContain('daily_summary'); // never past midnight
    expect(dueJobs(bkk('2026-11-18T20:00:00'))).not.toContain('weekly_summary'); // Wednesday
    expect(dueJobs(bkk('2026-11-22T20:00:00'))).toContain('weekly_summary'); // Sunday
  });

  it('retry keys are deterministic UUIDs', async () => {
    const a = await retryKeyFor('daily_summary', '2026-11-18', U1);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await retryKeyFor('daily_summary', '2026-11-18', U1)).toBe(a);
    expect(await retryKeyFor('daily_summary', '2026-11-19', U1)).not.toBe(a);
  });
});

describe('daily summary', () => {
  it('sends once per user per day even if the job runs repeatedly', async () => {
    const now = bkk('2026-11-18T21:00:00');
    await runScheduledJobs(deps, now, ['daily_summary']);
    await runScheduledJobs(deps, now, ['daily_summary']);
    await runScheduledJobs(deps, bkk('2026-11-18T22:00:00'));
    expect(line.pushes.filter((p) => p.to === U1)).toHaveLength(1);
    expect(line.pushes.filter((p) => p.to === U2)).toHaveLength(1);
    for (const p of line.pushes) expect(validateMessages(p.messages)).toEqual([]);
  });

  it('respects notification preferences and unfollowed users', async () => {
    await deps.repos.users.toggleNotification(U1, 'dailySummary');
    await deps.repos.users.setFollowing(U2, false);
    await runScheduledJobs(deps, bkk('2026-11-18T21:00:00'), ['daily_summary']);
    expect(line.pushes).toHaveLength(0);
  });

  it('a failed push is retried on the next run', async () => {
    const realPush = line.push.bind(line);
    let fail = true;
    line.push = async (...args) => {
      if (fail) throw new Error('LINE down');
      return realPush(...args);
    };
    const r1 = await runScheduledJobs(deps, bkk('2026-11-18T21:00:00'), ['daily_summary']);
    expect(r1[0]!.failed).toBe(2);
    fail = false;
    await runScheduledJobs(deps, bkk('2026-11-18T22:00:00'), ['daily_summary']);
    expect(line.pushes).toHaveLength(2);
  });
});

describe('bill reminders', () => {
  it('reminds N days before and on the due day, once per day, without creating transactions', async () => {
    await deps.fixedCosts.create(U1, { name: 'ค่าเน็ต', amountSatang: 59_900, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-11-20' }, remindDaysBefore: 2 }, '2026-11-01');

    await runScheduledJobs(deps, bkk('2026-11-17T08:00:00'), ['bill_reminders']); // 3 days before: nothing
    expect(line.pushes).toHaveLength(0);

    await runScheduledJobs(deps, bkk('2026-11-18T08:00:00'), ['bill_reminders']); // 2 days before
    await runScheduledJobs(deps, bkk('2026-11-18T09:00:00'), ['bill_reminders']); // re-run same day
    expect(line.pushes).toHaveLength(1);
    expect(validateMessages(line.pushes[0]!.messages)).toEqual([]);
    expect(JSON.stringify(line.pushes[0]!.messages)).toContain('ค่าเน็ต');

    await runScheduledJobs(deps, bkk('2026-11-20T08:00:00'), ['bill_reminders']); // due day
    expect(line.pushes).toHaveLength(2);
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);
  });

  it('does not remind for paid bills or users who turned reminders off', async () => {
    const fc = await deps.fixedCosts.create(U1, { name: 'ค่าห้อง', amountSatang: 650_000, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-11-19' } }, '2026-11-01');
    const [occ] = (await deps.repos.fixedCosts.listOccurrencesOfFixedCost(U1, fc.id, 5)).filter((o) => o.dueDate === '2026-11-19');
    await deps.fixedCosts.pay(U1, occ!.id, '2026-11-17');
    await runScheduledJobs(deps, bkk('2026-11-18T08:00:00'), ['bill_reminders']);
    expect(line.pushes).toHaveLength(0);

    await deps.fixedCosts.create(U2, { name: 'ค่าเน็ต', amountSatang: 59_900, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-11-19' } }, '2026-11-01');
    await deps.repos.users.toggleNotification(U2, 'billReminders');
    await runScheduledJobs(deps, bkk('2026-11-18T08:00:00'), ['bill_reminders']);
    expect(line.pushes).toHaveLength(0);
  });
});

describe('monthly summary and generation', () => {
  it('sends the previous period summary on the first day of the user period only', async () => {
    await deps.repos.users.setCycleStartDay(U2, 25);
    await runScheduledJobs(deps, bkk('2026-12-01T09:00:00'), ['monthly_summary']);
    expect(line.pushes.map((p) => p.to)).toEqual([U1]);
    await runScheduledJobs(deps, bkk('2026-12-01T10:00:00'), ['monthly_summary']);
    expect(line.pushes).toHaveLength(1);
    await runScheduledJobs(deps, bkk('2026-12-25T09:00:00'), ['monthly_summary']);
    expect(line.pushes.map((p) => p.to)).toEqual([U1, U2]);
  });

  it('occurrence generation is idempotent across runs', async () => {
    const fc = await deps.fixedCosts.create(U1, { name: 'ยิม', amountSatang: 30_000, categoryId: 'health', rule: { frequency: 'weekly', interval: 1, anchorDate: '2026-11-23' } }, '2026-11-18');
    const count = async () => (await deps.repos.fixedCosts.listOccurrencesOfFixedCost(U1, fc.id, 100)).length;
    await runScheduledJobs(deps, bkk('2026-12-01T00:15:00'), ['generate_occurrences']);
    const n = await count();
    await runScheduledJobs(deps, bkk('2026-12-01T01:15:00'), ['generate_occurrences']);
    expect(await count()).toBe(n);
  });

  it('cleanup runs without error', async () => {
    const [r] = await runScheduledJobs(deps, bkk('2026-11-18T03:00:00'), ['cleanup']);
    expect(r!.failed).toBe(0);
  });
});
