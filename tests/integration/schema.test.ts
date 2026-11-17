import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, testUserId, type TestDb } from '../helpers/db.ts';

let db: TestDb;
const U1 = testUserId(1);
const U2 = testUserId(2);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.pg.exec('truncate users cascade; truncate webhook_events; truncate job_runs;');
  await db.sql.query('insert into users (line_user_id) values ($1), ($2)', [U1, U2]);
});

async function insertFixedCost(userId = U1): Promise<string> {
  const [row] = await db.sql.query<{ id: string }>(
    `insert into fixed_costs (user_id, name, amount_satang, frequency, anchor_date)
     values ($1, 'ค่าเน็ต', 59900, 'monthly', '2026-01-31') returning id`,
    [userId],
  );
  return row!.id;
}

async function insertOccurrence(fixedCostId: string, key = 'M2026-02', userId = U1): Promise<string> {
  const [row] = await db.sql.query<{ id: string }>(
    `insert into fixed_cost_occurrences (user_id, fixed_cost_id, occurrence_key, due_date, amount_satang)
     values ($1, $2, $3, '2026-02-28', 59900) returning id`,
    [userId, fixedCostId, key],
  );
  return row!.id;
}

describe('schema: users', () => {
  it('rejects malformed LINE user ids', async () => {
    await expect(db.sql.query(`insert into users (line_user_id) values ('not-a-line-id')`)).rejects.toThrow();
  });

  it('rejects cycle start days outside 1..28', async () => {
    await expect(db.sql.query('update users set cycle_start_day = 31 where line_user_id = $1', [U1])).rejects.toThrow();
    await expect(db.sql.query('update users set cycle_start_day = 0 where line_user_id = $1', [U1])).rejects.toThrow();
  });
});

describe('schema: transactions', () => {
  const insertTxn = (amount: number) =>
    db.sql.query(
      `insert into transactions (user_id, type, amount_satang, category_id, txn_date)
       values ($1, 'expense', $2, 'food', '2026-11-18')`,
      [U1, amount],
    );

  it('accepts a positive satang amount', async () => {
    await insertTxn(6500);
    const rows = await db.sql.query<{ amount_satang: unknown }>('select amount_satang from transactions');
    expect(Number(rows[0]!.amount_satang)).toBe(6500);
  });

  it('rejects zero, negative and absurd amounts', async () => {
    await expect(insertTxn(0)).rejects.toThrow();
    await expect(insertTxn(-100)).rejects.toThrow();
    await expect(insertTxn(100_000_000_001)).rejects.toThrow();
  });

  it('rejects unknown transaction types', async () => {
    await expect(
      db.sql.query(
        `insert into transactions (user_id, type, amount_satang, category_id, txn_date) values ($1, 'transfer', 100, 'x', '2026-11-18')`,
        [U1],
      ),
    ).rejects.toThrow();
  });

  it('only expenses may settle a fixed-cost occurrence', async () => {
    const occ = await insertOccurrence(await insertFixedCost());
    await expect(
      db.sql.query(
        `insert into transactions (user_id, type, amount_satang, category_id, txn_date, fixed_cost_occurrence_id)
         values ($1, 'income', 59900, 'bills', '2026-02-28', $2)`,
        [U1, occ],
      ),
    ).rejects.toThrow(/transactions_occurrence_is_expense/);
  });

  it('an occurrence can be paid by only one live transaction', async () => {
    const occ = await insertOccurrence(await insertFixedCost());
    const pay = () =>
      db.sql.query(
        `insert into transactions (user_id, type, amount_satang, category_id, txn_date, fixed_cost_occurrence_id, source)
         values ($1, 'expense', 59900, 'bills', '2026-02-28', $2, 'fixed_cost') returning id`,
        [U1, occ],
      );
    const [first] = await pay();
    await expect(pay()).rejects.toThrow(/transactions_one_payment_per_occurrence/);

    // After soft-deleting the payment, the bill can be paid again.
    await db.sql.query('update transactions set deleted_at = now() where id = $1', [(first as { id: string }).id]);
    await expect(pay()).resolves.toHaveLength(1);
  });
});

describe('schema: fixed cost occurrences', () => {
  it('prevents duplicate occurrences for the same period key', async () => {
    const fc = await insertFixedCost();
    await insertOccurrence(fc, 'M2026-02');
    await expect(insertOccurrence(fc, 'M2026-02')).rejects.toThrow(/fixed_cost_occurrences_unique_key/);
  });

  it('ON CONFLICT DO NOTHING makes generation idempotent', async () => {
    const fc = await insertFixedCost();
    const gen = () =>
      db.sql.query(
        `insert into fixed_cost_occurrences (user_id, fixed_cost_id, occurrence_key, due_date, amount_satang)
         values ($1, $2, 'M2026-03', '2026-03-31', 59900)
         on conflict (fixed_cost_id, occurrence_key) do nothing returning id`,
        [U1, fc],
      );
    expect(await gen()).toHaveLength(1);
    expect(await gen()).toHaveLength(0);
    const rows = await db.sql.query('select 1 from fixed_cost_occurrences where fixed_cost_id = $1', [fc]);
    expect(rows).toHaveLength(1);
  });

  it('rejects end_date before anchor_date', async () => {
    await expect(
      db.sql.query(
        `insert into fixed_costs (user_id, name, amount_satang, frequency, anchor_date, end_date)
         values ($1, 'x', 100, 'monthly', '2026-05-01', '2026-04-01')`,
        [U1],
      ),
    ).rejects.toThrow();
  });
});

describe('schema: budgets and idempotency tables', () => {
  it('one budget per user per category', async () => {
    const ins = (u: string) =>
      db.sql.query(`insert into budgets (user_id, category_id, limit_satang) values ($1, 'food', 500000)`, [u]);
    await ins(U1);
    await expect(ins(U1)).rejects.toThrow(/budgets_one_per_category/);
    await expect(ins(U2)).resolves.toBeDefined(); // other user unaffected
  });

  it('webhook event ids are unique', async () => {
    const ins = () =>
      db.sql.query(
        `insert into webhook_events (webhook_event_id, event_type) values ('01HXYZ', 'message')
         on conflict do nothing returning webhook_event_id`,
      );
    expect(await ins()).toHaveLength(1);
    expect(await ins()).toHaveLength(0);
  });

  it('job runs are unique per job/run key/user', async () => {
    const ins = () =>
      db.sql.query(
        `insert into job_runs (job, run_key, user_id) values ('daily_summary', '2026-11-18', $1)
         on conflict do nothing returning job`,
        [U1],
      );
    expect(await ins()).toHaveLength(1);
    expect(await ins()).toHaveLength(0);
  });
});

describe('schema: data deletion', () => {
  it('deleting a user cascades to every owned row and leaves other users intact', async () => {
    const fc = await insertFixedCost(U1);
    await insertOccurrence(fc);
    await db.sql.query(
      `insert into transactions (user_id, type, amount_satang, category_id, txn_date) values ($1, 'expense', 100, 'food', '2026-11-18'), ($2, 'expense', 200, 'food', '2026-11-18')`,
      [U1, U2],
    );
    await db.sql.query(`insert into budgets (user_id, category_id, limit_satang) values ($1, 'food', 100)`, [U1]);
    await db.sql.query(
      `insert into savings_goals (user_id, name, target_satang) values ($1, 'เที่ยวญี่ปุ่น', 3000000)`,
      [U1],
    );

    await db.sql.query('delete from users where line_user_id = $1', [U1]);

    for (const table of ['transactions', 'fixed_costs', 'fixed_cost_occurrences', 'budgets', 'savings_goals']) {
      const rows = await db.sql.query(`select 1 from ${table} where user_id = $1`, [U1]);
      expect(rows, table).toHaveLength(0);
    }
    const others = await db.sql.query('select 1 from transactions where user_id = $1', [U2]);
    expect(others).toHaveLength(1);
  });
});

describe('schema: row level security', () => {
  it('is enabled on every table', async () => {
    const rows = await db.sql.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(11);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });
});
