import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppDeps } from '../../src/app.ts';
import { handleWebhookRequest } from '../../src/application/webhook.ts';
import type { FlexMessage, Message } from '../../src/infrastructure/line/messages.ts';
import type { AppDeps, Logger } from '../../src/presentation/line/context.ts';
import { ACTION_NAMES, encodePostback, RICH_MENU_ACTIONS } from '../../src/presentation/line/postback.ts';
import { postbackHandlers } from '../../src/presentation/line/handlers/postback-handlers.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';
import { validateMessages } from '../helpers/flex-validator.ts';
import { CHANNEL_SECRET, FakeLineClient, followEvent, postbackEvent, signedBody, textEvent } from '../helpers/line.ts';

let db: TestDb;
let line: FakeLineClient;
let deps: AppDeps;
const U1 = testUserId(0xa1);
const U2 = testUserId(0xb2);
// 2026-11-18 10:00 in Bangkok
const NOW = new Date('2026-11-18T03:00:00Z');
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  line = new FakeLineClient();
  line.profiles.set(U1, { userId: U1, displayName: 'ปาล์ม' });
  deps = createAppDeps(
    db.sql,
    { LINE_CHANNEL_ACCESS_TOKEN: 'unused-in-tests-xxxxxxxxxx', PUBLIC_ASSET_BASE_URL: 'https://assets.example.com/assets', DATA_EXPORT_URL: 'https://fn.example.com/data-export' },
    { line, clock: () => NOW, log: silent },
  );
});

async function send(events: unknown[]) {
  const { body, signature } = await signedBody(events);
  const r = await handleWebhookRequest(body, signature, CHANNEL_SECRET, deps);
  await r.work;
  return r;
}

async function say(userId: string, textIn: string): Promise<Message[]> {
  line.reset();
  await send([textEvent(userId, textIn)]);
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  return msgs;
}

async function tap(userId: string, data: string, params?: Record<string, string>): Promise<Message[]> {
  line.reset();
  await send([postbackEvent(userId, data, params)]);
  const msgs = line.lastReply();
  expect(validateMessages(msgs)).toEqual([]);
  return msgs;
}

/** Find the postback data of the first button/quick reply whose data starts with `a=<action>`. */
function findPostback(msgs: Message[], action: string): string {
  const json = JSON.stringify(msgs);
  const m = new RegExp(`"data":"(a=${action}[^"]*)"`).exec(json);
  if (!m) throw new Error(`no ${action} button in reply: ${json.slice(0, 400)}`);
  return m[1]!;
}

const altTexts = (msgs: Message[]) => msgs.map((m) => (m.type === 'flex' ? (m as FlexMessage).altText : m.type === 'text' ? m.text : ''));

describe('webhook security', () => {
  it('rejects a bad signature with 401 and processes nothing', async () => {
    const { body } = await signedBody([textEvent(U1, 'กินข้าว 65')]);
    const r = await handleWebhookRequest(body, 'bm90LXRoZS1zaWduYXR1cmU=', CHANNEL_SECRET, deps);
    await r.work;
    expect(r.status).toBe(401);
    expect(line.replies).toHaveLength(0);
  });

  it('rejects a missing signature and a tampered body', async () => {
    const { body, signature } = await signedBody([textEvent(U1, 'กินข้าว 65')]);
    expect((await handleWebhookRequest(body, null, CHANNEL_SECRET, deps)).status).toBe(401);
    expect((await handleWebhookRequest(body.replace('65', '9999'), signature, CHANNEL_SECRET, deps)).status).toBe(401);
  });

  it('accepts LINE verify (empty events)', async () => {
    const r = await send([]);
    expect(r.status).toBe(200);
  });

  it('duplicate webhook deliveries are processed once', async () => {
    const ev = textEvent(U1, 'กินข้าว 65');
    await send([ev]);
    await send([ev]); // redelivery, same webhookEventId
    await send([ev, ev]);
    expect(line.replies).toHaveLength(1);
  });

  it('ignores group messages', async () => {
    const ev = { ...textEvent(U1, 'กินข้าว 65'), source: { type: 'group', groupId: 'Cxxx', userId: U1 } };
    await send([ev]);
    expect(line.replies).toHaveLength(0);
  });
});

describe('onboarding', () => {
  it('follow → welcome → cycle → income → done', async () => {
    line.reset();
    await send([followEvent(U1)]);
    expect(altTexts(line.lastReply())[0]).toContain('ปาล์ม');
    expect(validateMessages(line.lastReply())).toEqual([]);

    let msgs = await tap(U1, encodePostback('onboard_start'));
    msgs = await tap(U1, findPostback(msgs, 'onboard_cycle&day=25'));
    expect(altTexts(msgs)[0]).toContain('ได้เงินเดือน');
    expect((await deps.repos.users.get(U1))!.cycleStartDay).toBe(25);

    msgs = await say(U1, 'ได้เงินเดือน 25000');
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    expect(altTexts(msgs).join(' ')).toContain('ตั้งค่าเสร็จแล้ว');
    expect((await deps.repos.users.get(U1))!.onboarding).toBe('done');
  });

  it('unfollow marks the user as not following (no reply)', async () => {
    await send([followEvent(U1)]);
    line.reset();
    await send([{ type: 'unfollow', mode: 'active', timestamp: 1, source: { type: 'user', userId: U1 }, webhookEventId: 'unf-1', deliveryContext: { isRedelivery: false } }]);
    expect(line.replies).toHaveLength(0);
    expect((await deps.repos.users.get(U1))!.isFollowing).toBe(false);
  });
});

describe('transaction via chat (PRD flow: parse → validate → confirm → save → recalc → success)', () => {
  beforeEach(async () => {
    await deps.repos.users.ensure(U1, 'ปาล์ม');
  });

  it('first message from an unknown user is greeted before the reply', async () => {
    const msgs = await say(U2, 'กินข้าว 65');
    expect(altTexts(msgs)[0]).toContain('ยินดีต้อนรับ');
    expect(altTexts(msgs)[1]).toContain('ยืนยันรายจ่าย');
  });

  it('"กินข้าว 65" shows a confirmation and saves only after confirm', async () => {
    let msgs = await say(U1, 'กินข้าว 65');
    expect(altTexts(msgs).some((t) => t.includes('ยืนยันรายจ่าย ฿65'))).toBe(true);
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);

    const confirm = findPostback(msgs, 'txn_confirm');
    msgs = await tap(U1, confirm);
    expect(altTexts(msgs)[0]).toContain('บันทึกรายจ่าย ฿65 แล้ว');
    expect(await deps.repos.transactions.countLive(U1)).toBe(1);

    msgs = await tap(U1, confirm); // double tap
    expect(await deps.repos.transactions.countLive(U1)).toBe(1);
    expect(altTexts(msgs)[0]).toContain('บันทึกไปแล้ว');
  });

  it('correcting the category and the date before saving', async () => {
    let msgs = await say(U1, 'ฟหกด 120');
    expect(msgs).toHaveLength(2); // confirm + category picker (not confident)
    msgs = await tap(U1, findPostback(msgs, 'txn_pick_category[^"]*c=transport'));
    msgs = await tap(U1, findPostback(msgs, 'txn_pick_date'), { date: '2026-11-15' });
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    const [t] = await deps.repos.transactions.listRecent(U1, 1);
    expect(t).toMatchObject({ categoryId: 'transport', txnDate: '2026-11-15', amountSatang: 12_000 });
  });

  it('cancel discards the draft', async () => {
    let msgs = await say(U1, 'กาแฟ 80');
    msgs = await tap(U1, findPostback(msgs, 'txn_cancel'));
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);
    msgs = await say(U1, 'ยกเลิก');
    expect(msgs).toHaveLength(1);
  });

  it('rich menu "add expense" → pick category → type amount', async () => {
    let msgs = await tap(U1, encodePostback('add_expense'));
    msgs = await tap(U1, findPostback(msgs, 'txn_start_category&t=expense&c=food'));
    msgs = await say(U1, '45');
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    const [t] = await deps.repos.transactions.listRecent(U1, 1);
    expect(t).toMatchObject({ categoryId: 'food', amountSatang: 4_500, source: 'rich_menu' });
  });

  it('ambiguous input asks instead of saving', async () => {
    const msgs = await say(U1, 'ข้าว 50 40');
    expect(altTexts(msgs)[0]).toContain('ทุกจำนวนต้องมีชื่อ');
    expect(await deps.repos.pending.get(U1, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('delete from success card and undo', async () => {
    let msgs = await say(U1, 'กินข้าว 65');
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    msgs = await tap(U1, findPostback(msgs, 'txn_delete_confirm'));
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);
    await tap(U1, findPostback(msgs, 'txn_undo'));
    expect(await deps.repos.transactions.countLive(U1)).toBe(1);
  });

  it('questions from the PRD are answered', async () => {
    for (const q of ['วันนี้ใช้ไปเท่าไหร่', 'เดือนนี้เหลือเงินเท่าไหร่', 'พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง', 'สัปดาห์นี้ใช้ไปเท่าไหร่', 'สรุปเดือน']) {
      const msgs = await say(U1, q);
      expect(msgs.length, q).toBeGreaterThan(0);
    }
  });
});

describe('fixed costs end to end', () => {
  it('add via chat, see in dashboard, pay once', async () => {
    await say(U1, 'ได้เงินเดือน 30000').then((m) => tap(U1, findPostback(m, 'txn_confirm')));
    let msgs = await tap(U1, encodePostback('fc_add'));
    msgs = await say(U1, 'ค่าห้อง 6500 ทุกวันที่ 25');
    expect(altTexts(msgs)[0]).toContain('ค่าห้อง');
    msgs = await tap(U1, findPostback(msgs, 'fc_create_confirm'));

    let dash = await deps.finance.dashboard(U1, '2026-11-18');
    expect(dash.available.availableSatang).toBe(3_000_000 - 650_000);

    msgs = await say(U1, 'มีบิลอะไรต้องจ่ายบ้าง');
    msgs = await tap(U1, findPostback(msgs, 'fc_pay'));
    const payConfirm = findPostback(msgs, 'fc_pay_confirm');
    await tap(U1, payConfirm);
    await tap(U1, payConfirm); // double tap

    dash = await deps.finance.dashboard(U1, '2026-11-18');
    expect(dash.available.expenseSatang).toBe(650_000);
    expect(dash.available.unpaidFixedCostsSatang).toBe(0);
    expect(dash.available.availableSatang).toBe(3_000_000 - 650_000);
  });

  it('pay a different actual amount', async () => {
    await tap(U1, encodePostback('fc_add'));
    let msgs = await say(U1, 'ค่าไฟ 1500 ทุกวันที่ 20');
    await tap(U1, findPostback(msgs, 'fc_create_confirm'));
    msgs = await tap(U1, encodePostback('fc_bills'));
    msgs = await tap(U1, findPostback(msgs, 'fc_pay'));
    await tap(U1, findPostback(msgs, 'fc_pay_custom'));
    await say(U1, '1732.50');
    const [t] = await deps.repos.transactions.listRecent(U1, 1);
    expect(t).toMatchObject({ amountSatang: 173_250, source: 'fixed_cost' });
  });
});

describe('budgets, goals and settings', () => {
  it('set a budget and get one alert when crossing 80%', async () => {
    let msgs = await tap(U1, encodePostback('budget_add'));
    await tap(U1, findPostback(msgs, 'budget_pick_category&c=food'));
    await say(U1, '1000');
    msgs = await say(U1, 'กินข้าว 850');
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    expect(altTexts(msgs).some((t) => t.includes('ใช้ไปแล้ว 85%'))).toBe(true);
    msgs = await say(U1, 'กินข้าว 10');
    msgs = await tap(U1, findPostback(msgs, 'txn_confirm'));
    expect(altTexts(msgs).some((t) => t.includes('%'))).toBe(false); // no repeat alert
  });

  it('goal: create and contribute', async () => {
    await tap(U1, encodePostback('goal_add'));
    let msgs = await say(U1, 'เที่ยวญี่ปุ่น 30000 เดือนละ 3000');
    msgs = await tap(U1, findPostback(msgs, 'goal_create_confirm'));
    msgs = await tap(U1, findPostback(msgs, 'goal_contribute'));
    msgs = await say(U1, '500');
    await tap(U1, findPostback(msgs, 'txn_confirm'));
    const [g] = await deps.finance.goals(U1);
    expect(g!.savedSatang).toBe(50_000);
  });

  it('toggle notification preference', async () => {
    await send([followEvent(U1)]);
    const msgs = await tap(U1, encodePostback('settings'));
    await tap(U1, findPostback(msgs, 'settings_toggle&k=dailySummary'));
    expect((await deps.repos.users.get(U1))!.notifications.dailySummary).toBe(false);
  });

  it('export gives a one-time link; delete removes everything', async () => {
    await say(U1, 'กินข้าว 65').then((m) => tap(U1, findPostback(m, 'txn_confirm')));
    const exp = await tap(U1, encodePostback('data_export'));
    expect(JSON.stringify(exp)).toContain('https://fn.example.com/data-export?token=');
    await tap(U1, encodePostback('data_delete_confirm'));
    expect(await deps.repos.users.get(U1)).toBeNull();
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);
  });
});

describe('routing coverage', () => {
  it('every postback action in the catalogue has a handler', () => {
    for (const a of ACTION_NAMES) expect(typeof postbackHandlers[a], a).toBe('function');
    expect(Object.keys(postbackHandlers).sort()).toEqual([...ACTION_NAMES].sort());
  });

  it('all six Rich Menu actions reply with valid messages', async () => {
    await send([followEvent(U1)]);
    for (const a of RICH_MENU_ACTIONS) {
      const msgs = await tap(U1, encodePostback(a));
      expect(msgs.length, a).toBeGreaterThan(0);
    }
  });

  it('every parameterless action replies without crashing (valid messages)', async () => {
    await send([followEvent(U1)]);
    const noParam = ['dashboard', 'add_expense', 'add_income', 'fixed_costs', 'budgets', 'reports', 'fc_add', 'fc_bills', 'budget_add', 'goals', 'goal_add', 'report_daily', 'report_weekly', 'report_monthly', 'report_categories', 'onboard_start', 'onboard_skip_income', 'settings', 'settings_cycle', 'data_export', 'data_delete', 'help', 'cancel_flow'] as const;
    for (const a of noParam) {
      const msgs = await tap(U1, encodePostback(a));
      expect(msgs.length, a).toBeGreaterThan(0);
      expect(JSON.stringify(msgs), a).not.toContain('สะดุด'); // not the generic error
    }
  });

  it('stale / forged / unknown postbacks get a friendly reply, not an error', async () => {
    for (const data of ['a=txn_confirm&id=00000000-0000-4000-8000-000000000000', 'a=unknown', 'garbage', 'a=txn_confirm&id=not-a-uuid']) {
      const msgs = await tap(U1, data);
      expect(altTexts(msgs)[0]).toContain('หมดอายุ');
    }
  });

  it("a user cannot act on another user's draft", async () => {
    const msgs = await say(U1, 'กินข้าว 65');
    const confirm = findPostback(msgs, 'txn_confirm');
    await tap(U2, confirm);
    expect(await deps.repos.transactions.countLive(U1)).toBe(0);
    expect(await deps.repos.transactions.countLive(U2)).toBe(0);
  });

  it('handler failures become a friendly error reply', async () => {
    deps.finance.dashboard = async () => {
      throw new Error('boom');
    };
    const msgs = await tap(U1, encodePostback('dashboard'));
    expect(altTexts(msgs)[0]).toContain('สะดุด');
  });
});
