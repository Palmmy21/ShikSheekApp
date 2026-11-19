import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { runScheduledJobs } from '../../src/application/jobs.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import { computeStreak, milestoneReached } from '../../src/domain/calculations/streak.ts';
import { applyGrant } from '../../src/domain/plans.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const A = testUserId(0xa11);
const B = testUserId(0xb22);
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const DAY = 86_400_000;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  line = new FakeLineClient();
  // real clock: streaks are measured on the database's "today"
  deps = createAppDeps(db.sql, { LINE_CHANNEL_ACCESS_TOKEN: 'x'.repeat(30), PUBLIC_ASSET_BASE_URL: 'https://a.example.com/a', DATA_EXPORT_URL: undefined, LIFF_URL: 'https://liff.line.me/2012666543-0a8D84ww' }, { line, ai: null, log: silent });
  for (const u of [A, B]) {
    await deps.repos.users.ensure(u, u === A ? 'ปาล์ม' : 'บี');
    await deps.repos.users.setOnboarding(u, 'done');
  }
});

async function send(user: string, event: unknown): Promise<Message[]> {
  line.reset();
  const { body, signature } = await signedBody([event]);
  await (await handleWebhookRequest(body, signature, CHANNEL_SECRET, deps)).work;
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  void user;
  return msgs;
}
const say = (u: string, t: string) => send(u, textEvent(u, t));
const tap = (u: string, d: string) => send(u, postbackEvent(u, d));
const all = (m: Message[]) => JSON.stringify(m);
const alt = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : '')).join(' | ');
async function record(u: string, text = 'กาแฟ 60') {
  const msgs = await say(u, text);
  const data = /"data":"(a=txn_confirm[^"]*)"/.exec(all(msgs))![1]!;
  return tap(u, data);
}
/** an entry recorded `daysAgo` days ago (by the database clock) */
async function pastEntry(u: string, daysAgo: number) {
  const t = await deps.repos.transactions.insert({ userId: u, type: 'expense', amountSatang: 5_000, categoryId: 'food', note: null, txnDate: '2026-11-01', source: 'chat' });
  await db.sql.query(`update transactions set created_at = now() - make_interval(days => $2) where id = $1`, [t.id, daysAgo]);
}
const ageUser = (u: string, days: number) => db.sql.query(`update users set created_at = now() - make_interval(days => $2) where line_user_id = $1`, [u, days]);

describe('streak maths', () => {
  it('counts consecutive days ending today or yesterday', () => {
    expect(computeStreak(['2026-11-17', '2026-11-18', '2026-11-19'], '2026-11-19')).toMatchObject({ days: 3, recordedToday: true, atRisk: false });
    expect(computeStreak(['2026-11-16', '2026-11-17', '2026-11-18'], '2026-11-19')).toMatchObject({ days: 3, recordedToday: false, atRisk: true });
    expect(computeStreak(['2026-11-10', '2026-11-19'], '2026-11-19')).toMatchObject({ days: 1, lastActive: '2026-11-19' });
    expect(computeStreak([], '2026-11-19')).toMatchObject({ days: 0, atRisk: false, lastActive: null });
    expect(milestoneReached({ days: 7, recordedToday: true, atRisk: false, lastActive: null }, 1)).toBe(7);
    expect(milestoneReached({ days: 7, recordedToday: true, atRisk: false, lastActive: null }, 2)).toBeNull(); // only first entry of the day
  });
  it('grants convert into the better plan and extend the same plan', () => {
    const now = Date.parse('2026-11-19T00:00:00Z');
    expect(applyGrant(null, 'plus', 30, now)).toEqual({ plan: 'plus', end: now + 30 * DAY });
    expect(applyGrant({ plan: 'plus', end: now + 10 * DAY }, 'plus', 30, now).end).toBe(now + 40 * DAY);
    // 129 days of Plus granted to a Pro user becomes 49 days of Pro
    expect(applyGrant({ plan: 'pro', end: now + 10 * DAY }, 'plus', 129, now)).toEqual({ plan: 'pro', end: now + 10 * DAY + 49 * DAY });
  });
});

describe('streaks in chat', () => {
  it('saved card shows the streak; milestone 3 is celebrated once', async () => {
    await pastEntry(A, 2);
    await pastEntry(A, 1);
    const saved = await record(A);
    expect(all(saved)).toContain('🔥 จดต่อเนื่อง 3 วัน');
    expect(alt(saved)).toContain('จดต่อเนื่อง 3 วันแล้ว');
    expect(alt(await record(A, 'ขนม 20'))).not.toContain('จดต่อเนื่อง 3 วันแล้ว'); // second entry today
  });

  it('a 30-day streak earns Plus once', async () => {
    for (let d = 29; d >= 1; d--) await pastEntry(A, d);
    const saved = await record(A);
    expect(alt(saved)).toContain('30 วันติด');
    const sub = await deps.repos.plans.getSubscription(A);
    expect(sub).toMatchObject({ plan: 'plus', source: 'promo' });
    await record(A, 'ขนม 20');
    expect(await deps.repos.plans.getSubscription(A)).toEqual(sub); // not granted twice
  });
});

describe('referrals', () => {
  it('invite card → friend enters code → after 3 entries both get 30 days of Plus, inviter is notified once', async () => {
    const card = await say(A, 'ชวนเพื่อน');
    const code = /โค้ด ([A-Z0-9]{6})/.exec(alt(card))![1]!;
    expect(all(card)).toContain('https://line.me/R/share?text=');
    expect(decodeURIComponent(all(card))).toContain(`?ref=${code}`);

    expect(alt(await say(B, `โค้ด ${code.toLowerCase()}`))).toContain('รับคำชวนจาก ปาล์ม');
    await record(B, 'ข้าว 50');
    await record(B, 'กาแฟ 40');
    expect(line.pushes).toHaveLength(0);
    const third = await record(B, 'ขนม 25');
    expect(alt(third)).toContain('คุณกับเพื่อนได้ Plus ฟรี 30 วัน');
    expect(line.pushes.map((p) => p.to)).toEqual([A]);
    expect(alt(line.pushes[0]!.messages)).toContain('เพื่อนที่คุณชวนเริ่มจดแล้ว');
    expect(await deps.repos.plans.getSubscription(A)).toMatchObject({ plan: 'plus', source: 'referral' });
    expect(await deps.repos.plans.getSubscription(B)).toMatchObject({ plan: 'plus', source: 'referral' });

    await record(B, 'น้ำ 10'); // 4th entry: nothing more
    expect(line.pushes).toHaveLength(0);
    expect(alt(await say(A, 'ชวนเพื่อน'))).toContain(code);
    expect(all(await say(A, 'ชวนเพื่อน'))).toContain('1 / 12 คน');
  });

  it('rejects own code, old accounts, a second code, unknown codes and A↔B loops', async () => {
    const codeA = (await deps.engagement.referralInfo(A)).code;
    const codeB = (await deps.engagement.referralInfo(B)).code;
    expect(alt(await say(A, `โค้ด ${codeA}`))).toContain('โค้ดของคุณเอง');
    expect(alt(await say(A, 'โค้ด ZZZZZZ'))).toContain('ไม่เจอโค้ดนี้');
    expect((await deps.engagement.claim(B, codeA)).status).toBe('ok');
    expect((await deps.engagement.claim(B, codeA)).status).toBe('already');
    expect((await deps.engagement.claim(A, codeB)).status).toBe('self'); // B was invited by A
    const C = testUserId(0xc33);
    await deps.repos.users.ensure(C, 'ซี');
    await ageUser(C, 30);
    expect(alt(await say(C, `โค้ด ${codeA}`))).toContain('7 วันแรก');
  });

  it('the inviter reward stops after 12 friends', async () => {
    const codeA = (await deps.engagement.referralInfo(A)).code;
    for (let i = 0; i < 12; i++) {
      const u = testUserId(0xd00 + i);
      await deps.repos.users.ensure(u, null);
      await deps.repos.engagement.addReferral(u, A);
      await deps.repos.engagement.markReferralRewarded(u);
    }
    await deps.engagement.claim(B, codeA);
    for (const t of ['ข้าว 50', 'กาแฟ 40', 'ขนม 25']) await record(B, t);
    expect(await deps.repos.plans.getSubscription(B)).toMatchObject({ plan: 'plus' }); // friend still rewarded
    expect(await deps.repos.plans.getSubscription(A)).toBeNull();
    expect(line.pushes).toHaveLength(0);
  });
});

describe('retention jobs', () => {
  it('20:00 reminds only when a streak would break tonight, once per day', async () => {
    await pastEntry(A, 2);
    await pastEntry(A, 1); // A: 2-day streak, nothing today → at risk
    await pastEntry(B, 1);
    await pastEntry(B, 0); // B: recorded today → fine
    const now = new Date();
    await runScheduledJobs(deps, now, ['streak_reminders']);
    await runScheduledJobs(deps, now, ['streak_reminders']);
    expect(line.pushes.map((p) => p.to)).toEqual([A]);
    expect(alt(line.pushes[0]!.messages)).toContain('สตรีค 2 วันจะหลุดคืนนี้');
    await deps.repos.users.setNotification(A, 'streakReminders', false);
    line.reset();
    await db.pg.exec('truncate job_runs;');
    await runScheduledJobs(deps, now, ['streak_reminders']);
    expect(line.pushes).toHaveLength(0);
  });

  it('win-back fires once when the last entry was exactly 3 days ago', async () => {
    await pastEntry(A, 3);
    await pastEntry(B, 5);
    await runScheduledJobs(deps, new Date(), ['winback']);
    await runScheduledJobs(deps, new Date(), ['winback']);
    expect(line.pushes.map((p) => p.to)).toEqual([A]);
    expect(alt(line.pushes[0]!.messages)).toContain('คิดถึงน้า');
  });
});
