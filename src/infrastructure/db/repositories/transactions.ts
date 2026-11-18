import type { LocalDate } from '../../../domain/dates.ts';
import type { Transaction, TransactionSource, TransactionType } from '../../../domain/entities/index.ts';
import { toIso, toSafeInt, type Sql } from '../sql.ts';

interface TxnRow {
  id: string;
  user_id: string;
  type: TransactionType;
  amount_satang: unknown;
  category_id: string;
  note: string | null;
  txn_date: string;
  source: TransactionSource;
  fixed_cost_occurrence_id: string | null;
  savings_goal_id: string | null;
  external_ref: string | null;
  created_at: unknown;
  deleted_at: unknown;
}

// Dates are selected as text so no driver ever shifts them through a timezone.
const COLUMNS = `id, user_id, type, amount_satang, category_id, note, txn_date::text as txn_date, source,
  fixed_cost_occurrence_id, savings_goal_id, external_ref, created_at, deleted_at`;

export function mapTransaction(r: TxnRow): Transaction {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    amountSatang: toSafeInt(r.amount_satang, 'amount_satang'),
    categoryId: r.category_id,
    note: r.note,
    txnDate: r.txn_date,
    source: r.source,
    fixedCostOccurrenceId: r.fixed_cost_occurrence_id,
    savingsGoalId: r.savings_goal_id,
    externalRef: r.external_ref ?? null,
    createdAt: toIso(r.created_at),
    deletedAt: r.deleted_at === null || r.deleted_at === undefined ? null : toIso(r.deleted_at),
  };
}

export interface NewTransaction {
  userId: string;
  type: TransactionType;
  amountSatang: number;
  categoryId: string;
  note: string | null;
  txnDate: LocalDate;
  source: TransactionSource;
  fixedCostOccurrenceId?: string | null;
  savingsGoalId?: string | null;
  externalRef?: string | null;
}

export function transactionRepo(sql: Sql) {
  return {
    async insert(t: NewTransaction): Promise<Transaction> {
      const rows = await sql.query<TxnRow>(
        `insert into transactions (user_id, type, amount_satang, category_id, note, txn_date, source, fixed_cost_occurrence_id, savings_goal_id, external_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${COLUMNS}`,
        [t.userId, t.type, t.amountSatang, t.categoryId, t.note, t.txnDate, t.source, t.fixedCostOccurrenceId ?? null, t.savingsGoalId ?? null, t.externalRef ?? null],
      );
      return mapTransaction(rows[0]!);
    },

    async get(userId: string, id: string): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(`select ${COLUMNS} from transactions where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    /** Live transactions with start <= txn_date <= end. */
    async listByRange(userId: string, start: LocalDate, end: LocalDate): Promise<Transaction[]> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions
         where user_id = $1 and deleted_at is null and txn_date between $2 and $3
         order by txn_date, created_at`,
        [userId, start, end],
      );
      return rows.map(mapTransaction);
    },

    /** All live saving transactions (savings progress is derived from them). */
    async listSavings(userId: string): Promise<Transaction[]> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions where user_id = $1 and deleted_at is null and type = 'saving' order by txn_date`,
        [userId],
      );
      return rows.map(mapTransaction);
    },

    async listRecent(userId: string, limit: number, offset = 0): Promise<Transaction[]> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions where user_id = $1 and deleted_at is null
         order by txn_date desc, created_at desc limit $2 offset $3`,
        [userId, limit, offset],
      );
      return rows.map(mapTransaction);
    },

    /** Insert unless a live transaction with the same external_ref exists. Returns null when skipped. */
    async insertIfNewRef(t: NewTransaction & { externalRef: string }): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(
        `insert into transactions (user_id, type, amount_satang, category_id, note, txn_date, source, external_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (user_id, external_ref) where external_ref is not null and deleted_at is null do nothing
         returning ${COLUMNS}`,
        [t.userId, t.type, t.amountSatang, t.categoryId, t.note, t.txnDate, t.source, t.externalRef],
      );
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    async findByExternalRef(userId: string, externalRef: string): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions where user_id = $1 and external_ref = $2 and deleted_at is null`,
        [userId, externalRef],
      );
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    /** Edit a live transaction. Only provided fields change. */
    async update(
      userId: string,
      id: string,
      patch: Partial<Pick<Transaction, 'type' | 'amountSatang' | 'categoryId' | 'note' | 'txnDate'>>,
    ): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(
        `update transactions set
           type = coalesce($3, type),
           amount_satang = coalesce($4::bigint, amount_satang),
           category_id = coalesce($5, category_id),
           note = case when $6::boolean then $7 else note end,
           txn_date = coalesce($8::date, txn_date)
         where user_id = $1 and id = $2 and deleted_at is null
         returning ${COLUMNS}`,
        [userId, id, patch.type ?? null, patch.amountSatang ?? null, patch.categoryId ?? null, patch.note !== undefined, patch.note ?? null, patch.txnDate ?? null],
      );
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    /** Filtered, paginated list (newest first). `q` matches the note (case-insensitive). */
    async search(
      userId: string,
      f: { limit: number; offset: number; type?: string | null; categoryId?: string | null; from?: string | null; to?: string | null; q?: string | null },
    ): Promise<Transaction[]> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions
         where user_id = $1 and deleted_at is null
           and ($2::text is null or type = $2)
           and ($3::text is null or category_id = $3)
           and ($4::date is null or txn_date >= $4)
           and ($5::date is null or txn_date <= $5)
           and ($6::text is null or note ilike '%' || $6 || '%')
         order by txn_date desc, created_at desc limit $7 offset $8`,
        [userId, f.type ?? null, f.categoryId ?? null, f.from ?? null, f.to ?? null, f.q ? f.q.replace(/[%_\\]/g, '') : null, f.limit, f.offset],
      );
      return rows.map(mapTransaction);
    },

    async countLive(userId: string): Promise<number> {
      const rows = await sql.query<{ n: unknown }>(
        'select count(*) as n from transactions where user_id = $1 and deleted_at is null',
        [userId],
      );
      return toSafeInt(rows[0]?.n ?? 0);
    },

    /** Soft delete; returns the row as it was if it was live. */
    async softDelete(userId: string, id: string): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(
        `update transactions set deleted_at = now() where user_id = $1 and id = $2 and deleted_at is null returning ${COLUMNS}`,
        [userId, id],
      );
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    async restore(userId: string, id: string): Promise<Transaction | null> {
      const rows = await sql.query<TxnRow>(
        `update transactions set deleted_at = null where user_id = $1 and id = $2 and deleted_at is not null returning ${COLUMNS}`,
        [userId, id],
      );
      return rows[0] ? mapTransaction(rows[0]) : null;
    },

    async listAllForExport(userId: string): Promise<Transaction[]> {
      const rows = await sql.query<TxnRow>(
        `select ${COLUMNS} from transactions where user_id = $1 and deleted_at is null order by txn_date, created_at`,
        [userId],
      );
      return rows.map(mapTransaction);
    },
  };
}
export type TransactionRepo = ReturnType<typeof transactionRepo>;
