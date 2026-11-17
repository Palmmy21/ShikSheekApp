import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceService } from '../../src/application/services/finance-service.ts';
import { createFixedCostService } from '../../src/application/services/fixed-cost-service.ts';
import { createTransactionService, ValidationError, type TransactionDraft } from '../../src/application/services/transaction-service.ts';
import { createRepos } from '../../src/infrastructure/db/repositories/index.ts';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';

let db: TestDb;
const U1 = testUserId(1);
const U2 = testUserId(2);
const TODAY = '2026-11-18';

const draft = (over: Partial<TransactionDraft> = {}): TransactionDraft => ({
  type: 'expense',
  amountSatang: 6_500,
  categoryId: 'food',
  categoryConfident: true,
  note: 'กินข้าว',
  txnDate: TODAY,
  source: 'chat',
  ...over,
});

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  const repos = createRepos(db.sql);
  await repos.users.ensure(U1, 'ไก่หนึ่ง');
  await repos.users.ensure(U2, 'ไก่สอง');
});

const services = () => ({
  txns: createTransactionService(db.sql),
  fc: createFixedCostService(db.sql),
  fin: createFinanceService(db.sql),
  repos: createRepos(db.sql),
});

describe('transaction confirmation flow', () => {
  it('saves only after confirm; a second confirm tap does not duplicate', async () => {
    const { txns, repos } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    expect(await repos.transactions.countLive(U1)).toBe(0);

    const first = await txns.confirm(U1, d.id, TODAY);
    expect(first.status).toBe('saved');
    const second = await txns.confirm(U1, d.id, TODAY);
    expect(second.status).toBe('already_confirmed');
    expect(await repos.transactions.countLive(U1)).toBe(1);
  });

  it('concurrent double taps save exactly once', async () => {
    const { txns, repos } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    const results = await Promise.all([txns.confirm(U1, d.id, TODAY), txns.confirm(U1, d.id, TODAY)]);
    expect(results.filter((r) => r.status === 'saved')).toHaveLength(1);
    expect(await repos.transactions.countLive(U1)).toBe(1);
  });

  it('cancelled drafts cannot be confirmed', async () => {
    const { txns, repos } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    expect(await txns.cancel(U1, d.id)).toBe(true);
    expect((await txns.confirm(U1, d.id, TODAY)).status).toBe('cancelled');
    expect(await repos.transactions.countLive(U1)).toBe(0);
  });

  it('expired drafts cannot be confirmed', async () => {
    const { txns } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    await db.sql.query(`update pending_actions set expires_at = now() - interval '1 minute' where id = $1`, [d.id]);
    expect((await txns.confirm(U1, d.id, TODAY)).status).toBe('expired');
  });

  it('a new draft cancels the previous open one', async () => {
    const { txns } = services();
    const a = await txns.createDraft(U1, draft(), TODAY);
    await txns.createDraft(U1, draft({ amountSatang: 100 }), TODAY);
    expect((await txns.confirm(U1, a.id, TODAY)).status).toBe('cancelled');
  });

  it('correcting category and date before confirm', async () => {
    const { txns } = services();
    const d = await txns.createDraft(U1, draft({ categoryId: 'other_expense', categoryConfident: false }), TODAY);
    await txns.updateDraft(U1, d.id, { categoryId: 'transport', txnDate: '2026-11-17' }, TODAY);
    const r = await txns.confirm(U1, d.id, TODAY);
    expect(r.status === 'saved' && r.transaction).toMatchObject({ categoryId: 'transport', txnDate: '2026-11-17', amountSatang: 6_500 });
  });

  it('rejects invalid drafts (wrong category kind, far dates, bad amount)', async () => {
    const { txns } = services();
    await expect(txns.createDraft(U1, draft({ categoryId: 'salary' }), TODAY)).rejects.toBeInstanceOf(ValidationError);
    await expect(txns.createDraft(U1, draft({ txnDate: '2026-12-31' }), TODAY)).rejects.toBeInstanceOf(ValidationError);
    await expect(txns.createDraft(U1, draft({ txnDate: '2025-01-01' }), TODAY)).rejects.toBeInstanceOf(ValidationError);
    await expect(txns.createDraft(U1, draft({ amountSatang: 0 }), TODAY)).rejects.toBeInstanceOf(ValidationError);
    await expect(txns.createDraft(U1, draft({ type: 'saving', categoryId: 'savings' }), TODAY)).rejects.toBeInstanceOf(ValidationError);
  });

  it('delete and undo', async () => {
    const { txns, repos } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    const saved = await txns.confirm(U1, d.id, TODAY);
    if (saved.status !== 'saved') throw new Error('not saved');
    expect(await txns.remove(U1, saved.transaction.id)).not.toBeNull();
    expect(await repos.transactions.countLive(U1)).toBe(0);
    expect(await txns.remove(U1, saved.transaction.id)).toBeNull(); // already deleted
    expect(await txns.restore(U1, saved.transaction.id)).not.toBeNull();
    expect(await repos.transactions.countLive(U1)).toBe(1);
  });
});

describe('user data isolation', () => {
  it('another user cannot confirm, read, edit or delete my records', async () => {
    const { txns, repos, fc } = services();
    const d = await txns.createDraft(U1, draft(), TODAY);
    expect((await txns.confirm(U2, d.id, TODAY)).status).toBe('not_found');
    expect(await txns.cancel(U2, d.id)).toBe(false);
    expect(await txns.updateDraft(U2, d.id, { categoryId: 'transport' }, TODAY)).toBeNull();

    const saved = await txns.confirm(U1, d.id, TODAY);
    if (saved.status !== 'saved') throw new Error('not saved');
    expect(await txns.get(U2, saved.transaction.id)).toBeNull();
    expect(await txns.remove(U2, saved.transaction.id)).toBeNull();
    expect(await repos.transactions.countLive(U1)).toBe(1);

    const cost = await fc.create(U1, { name: 'ค่าห้อง', amountSatang: 650_000, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-11-25' } }, TODAY);
    const [occ] = await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id);
    expect((await fc.pay(U2, occ!.id, TODAY)).status).toBe('not_found');
    expect(await fc.skip(U2, occ!.id)).toBeNull();
    expect(await fc.pause(U2, cost.id, TODAY)).toBe(false);
    expect(await fc.remove(U2, cost.id, TODAY)).toBe(false);
    expect(await fc.list(U2, TODAY)).toEqual([]);
  });
});

describe('fixed costs and available balance', () => {
  const rent = { name: 'ค่าห้อง', amountSatang: 650_000, categoryId: 'bills', rule: { frequency: 'monthly' as const, interval: 1, anchorDate: '2026-11-25' } };

  it('generation is idempotent', async () => {
    const { fc, repos } = services();
    const cost = await fc.create(U1, rent, TODAY);
    const count = async () => (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 100)).length;
    const initial = await count();
    expect(initial).toBe(2); // Nov 25, Dec 25 (within 45 days)
    expect(await fc.generateForUser(U1, '2027-01-31')).toBe(1);
    expect(await fc.generateForUser(U1, '2027-01-31')).toBe(0);
    expect(await fc.generateForAllUsers('2027-01-31')).toBe(0);
    expect(await count()).toBe(3);
  });

  it('unpaid bill reduces available; paying it is counted exactly once', async () => {
    const { fc, fin, txns, repos } = services();
    const salary = await txns.createDraft(U1, draft({ type: 'income', categoryId: 'salary', amountSatang: 2_500_000, txnDate: '2026-11-01' }), TODAY);
    await txns.confirm(U1, salary.id, TODAY);
    const cost = await fc.create(U1, rent, TODAY);

    const before = await fin.dashboard(U1, TODAY);
    expect(before.available.unpaidFixedCostsSatang).toBe(650_000);
    expect(before.available.availableSatang).toBe(1_850_000);

    const [occ] = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).filter((o) => o.dueDate === '2026-11-25');
    const paid = await fc.pay(U1, occ!.id, TODAY);
    expect(paid.status).toBe('paid');
    expect((await fc.pay(U1, occ!.id, TODAY)).status).toBe('already_resolved'); // double tap

    const after = await fin.dashboard(U1, TODAY);
    expect(after.available.unpaidFixedCostsSatang).toBe(0);
    expect(after.available.expenseSatang).toBe(650_000);
    expect(after.available.availableSatang).toBe(1_850_000); // unchanged: moved from "unpaid" to "spent"
  });

  it('paying a different actual amount (electricity) uses the actual amount', async () => {
    const { fc, fin, repos } = services();
    const cost = await fc.create(U1, { ...rent, name: 'ค่าไฟ', amountSatang: 150_000 }, TODAY);
    const [occ] = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).filter((o) => o.dueDate === '2026-11-25');
    await fc.pay(U1, occ!.id, TODAY, 173_250);
    const d = await fin.dashboard(U1, TODAY);
    expect(d.available.availableSatang).toBe(-173_250);
  });

  it('deleting the payment makes the bill unpaid again; undo re-pays it', async () => {
    const { fc, fin, txns, repos } = services();
    const cost = await fc.create(U1, rent, TODAY);
    const [occ] = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).filter((o) => o.dueDate === '2026-11-25');
    const paid = await fc.pay(U1, occ!.id, TODAY);
    if (paid.status !== 'paid') throw new Error();
    await txns.remove(U1, paid.transaction.id);
    expect((await repos.fixedCosts.getOccurrence(U1, occ!.id))!.status).toBe('pending');
    expect((await fin.dashboard(U1, TODAY)).available.availableSatang).toBe(-650_000);
    await txns.restore(U1, paid.transaction.id);
    expect((await repos.fixedCosts.getOccurrence(U1, occ!.id))!.status).toBe('paid');
    expect((await fin.dashboard(U1, TODAY)).available.availableSatang).toBe(-650_000);
  });

  it('skip removes the obligation without a transaction', async () => {
    const { fc, fin, repos } = services();
    const cost = await fc.create(U1, rent, TODAY);
    const [occ] = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).filter((o) => o.dueDate === '2026-11-25');
    expect(await fc.skip(U1, occ!.id)).not.toBeNull();
    expect((await fc.pay(U1, occ!.id, TODAY)).status).toBe('already_resolved');
    expect((await fin.dashboard(U1, TODAY)).available.availableSatang).toBe(0);
    expect(await repos.transactions.countLive(U1)).toBe(0);
  });

  it('pause removes future bills; resume does not resurrect bills from the paused period', async () => {
    const { fc, repos } = services();
    const cost = await fc.create(U1, rent, TODAY);
    expect(await fc.pause(U1, cost.id, TODAY)).toBe(true);
    expect(await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).toEqual([]);
    expect(await fc.generateForUser(U1, '2027-03-31')).toBe(0); // paused: nothing generated

    expect(await fc.resume(U1, cost.id, '2027-01-10')).toBe(true);
    const dates = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10)).map((o) => o.dueDate).sort();
    expect(dates[0]).toBe('2027-01-25'); // Nov/Dec bills from the pause are not recreated
  });

  it('delete keeps paid history but removes future pending bills', async () => {
    const { fc, repos } = services();
    const cost = await fc.create(U1, rent, TODAY);
    const occs = await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 10);
    const nov = occs.find((o) => o.dueDate === '2026-11-25')!;
    await fc.pay(U1, nov.id, TODAY);
    expect(await fc.remove(U1, cost.id, TODAY)).toBe(true);
    expect(await repos.transactions.countLive(U1)).toBe(1);
    expect(await fc.list(U1, TODAY)).toEqual([]);
  });

  it('monthly day-31 bills land on the last day of short months', async () => {
    const { fc, repos } = services();
    const cost = await fc.create(U1, { ...rent, rule: { frequency: 'monthly', interval: 1, anchorDate: '2027-01-31' } }, '2027-01-20');
    await fc.generateForUser(U1, '2028-03-31');
    const dates = (await repos.fixedCosts.listOccurrencesOfFixedCost(U1, cost.id, 100)).map((o) => o.dueDate);
    expect(dates).toContain('2027-02-28');
    expect(dates).toContain('2028-02-29');
    expect(dates).toContain('2027-04-30');
  });
});

describe('budgets and goals', () => {
  it('threshold alerts fire once per period and respect preferences', async () => {
    const { fin, txns, repos } = services();
    await fin.setBudget(U1, 'food', 10_000); // ฿100
    const spend = async (amount: number) => {
      const d = await txns.createDraft(U1, draft({ amountSatang: amount }), TODAY);
      await txns.confirm(U1, d.id, TODAY);
      return fin.budgetAlertsFor(U1, TODAY, 'food');
    };
    expect(await spend(4_000)).toEqual([]);
    expect((await spend(1_000)).map((a) => a.threshold)).toEqual([50]);
    expect(await spend(1_000)).toEqual([]);
    expect((await spend(5_000)).map((a) => a.threshold)).toEqual([100]); // 80 and 100 crossed → highest
    expect(await spend(5_000)).toEqual([]);

    await repos.users.toggleNotification(U1, 'budgetAlerts');
    await fin.setBudget(U1, 'transport', 100);
    const d = await txns.createDraft(U1, draft({ categoryId: 'transport', amountSatang: 500 }), TODAY);
    await txns.confirm(U1, d.id, TODAY);
    expect(await fin.budgetAlertsFor(U1, TODAY, 'transport')).toEqual([]);
  });

  it('cannot budget an income category', async () => {
    const { fin } = services();
    await expect(fin.setBudget(U1, 'salary', 100)).rejects.toBeInstanceOf(ValidationError);
  });

  it('savings contributions reduce the reservation and build progress', async () => {
    const { fin, txns } = services();
    const salary = await txns.createDraft(U1, draft({ type: 'income', categoryId: 'salary', amountSatang: 2_000_000 }), TODAY);
    await txns.confirm(U1, salary.id, TODAY);
    const goal = await fin.createGoal(U1, { name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 300_000 });
    expect((await fin.dashboard(U1, TODAY)).available.availableSatang).toBe(1_700_000);

    const s = await txns.createDraft(U1, draft({ type: 'saving', categoryId: 'savings', amountSatang: 100_000, savingsGoalId: goal.id }), TODAY);
    await txns.confirm(U1, s.id, TODAY);
    const dash = await fin.dashboard(U1, TODAY);
    expect(dash.available.availableSatang).toBe(1_700_000);
    expect(dash.available.savingsReservedSatang).toBe(200_000);
    expect((await fin.goalProgress(U1, goal.id))!.savedSatang).toBe(100_000);
  });
});

describe('summaries', () => {
  it('month summary compares with the previous period', async () => {
    const { fin, txns } = services();
    for (const [amount, date] of [[10_000, '2026-10-05'], [30_000, '2026-11-02'], [5_000, '2026-11-18']] as const) {
      const d = await txns.createDraft(U1, draft({ amountSatang: amount, txnDate: date }), TODAY);
      await txns.confirm(U1, d.id, TODAY);
    }
    const m = await fin.monthSummary(U1, TODAY);
    expect(m.totals.expenseSatang).toBe(35_000);
    expect(m.previousTotals!.expenseSatang).toBe(10_000);
    expect(m.expenseChangeSatang).toBe(25_000);

    const day = await fin.daySummary(U1, TODAY);
    expect(day.totals.expenseSatang).toBe(5_000);
  });
});
