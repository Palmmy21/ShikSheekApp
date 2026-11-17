import type { LocalDate } from '../../../domain/dates.ts';
import type { FixedCost, FixedCostOccurrence, FixedCostStatus } from '../../../domain/entities/index.ts';
import type { Frequency, StoredOccurrenceStatus } from '../../../domain/recurrence.ts';
import { toSafeInt, type Sql } from '../sql.ts';

interface FcRow {
  id: string;
  user_id: string;
  name: string;
  amount_satang: unknown;
  category_id: string;
  frequency: Frequency;
  interval_count: number;
  anchor_date: string;
  end_date: string | null;
  remind_days_before: number;
  status: FixedCostStatus;
  active_from: string;
}
interface OccRow {
  id: string;
  user_id: string;
  fixed_cost_id: string;
  occurrence_key: string;
  due_date: string;
  amount_satang: unknown;
  status: StoredOccurrenceStatus;
}

// Explicit column lists (optionally table-qualified) so joins never hit ambiguous names.
const fcColumns = (alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `${p}id, ${p}user_id, ${p}name, ${p}amount_satang, ${p}category_id, ${p}frequency, ${p}interval_count,
  ${p}anchor_date::text as anchor_date, ${p}end_date::text as end_date, ${p}remind_days_before, ${p}status, ${p}active_from::text as active_from`;
};
const occColumns = (alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `${p}id, ${p}user_id, ${p}fixed_cost_id, ${p}occurrence_key, ${p}due_date::text as due_date, ${p}amount_satang, ${p}status`;
};
const FC_COLUMNS = fcColumns();
const OCC_COLUMNS = occColumns();

function mapFc(r: FcRow): FixedCost {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    amountSatang: toSafeInt(r.amount_satang),
    categoryId: r.category_id,
    frequency: r.frequency,
    interval: Number(r.interval_count),
    anchorDate: r.anchor_date,
    endDate: r.end_date,
    remindDaysBefore: Number(r.remind_days_before),
    status: r.status,
    activeFrom: r.active_from,
  };
}
export function mapOccurrence(r: OccRow): FixedCostOccurrence {
  return {
    id: r.id,
    userId: r.user_id,
    fixedCostId: r.fixed_cost_id,
    occurrenceKey: r.occurrence_key,
    dueDate: r.due_date,
    amountSatang: toSafeInt(r.amount_satang),
    status: r.status,
  };
}

export type NewFixedCost = Omit<FixedCost, 'id' | 'status'>;

export function fixedCostRepo(sql: Sql) {
  return {
    async insert(fc: NewFixedCost): Promise<FixedCost> {
      const rows = await sql.query<FcRow>(
        `insert into fixed_costs (user_id, name, amount_satang, category_id, frequency, interval_count, anchor_date, end_date, remind_days_before, active_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${FC_COLUMNS}`,
        [fc.userId, fc.name, fc.amountSatang, fc.categoryId, fc.frequency, fc.interval, fc.anchorDate, fc.endDate, fc.remindDaysBefore, fc.activeFrom],
      );
      return mapFc(rows[0]!);
    },

    async get(userId: string, id: string): Promise<FixedCost | null> {
      const rows = await sql.query<FcRow>(
        `select ${FC_COLUMNS} from fixed_costs where user_id = $1 and id = $2 and deleted_at is null`,
        [userId, id],
      );
      return rows[0] ? mapFc(rows[0]) : null;
    },

    async list(userId: string): Promise<FixedCost[]> {
      const rows = await sql.query<FcRow>(
        `select ${FC_COLUMNS} from fixed_costs where user_id = $1 and deleted_at is null order by status, name`,
        [userId],
      );
      return rows.map(mapFc);
    },

    async listActiveAllUsers(): Promise<FixedCost[]> {
      const rows = await sql.query<FcRow>(
        `select ${fcColumns('fc')} from fixed_costs fc
         join users u on u.line_user_id = fc.user_id
         where fc.deleted_at is null and fc.status = 'active'`,
      );
      return rows.map(mapFc);
    },

    async pause(userId: string, id: string): Promise<boolean> {
      const rows = await sql.query(
        `update fixed_costs set status = 'paused' where user_id = $1 and id = $2 and deleted_at is null and status = 'active' returning 1`,
        [userId, id],
      );
      return rows.length === 1;
    },

    async resume(userId: string, id: string, today: LocalDate): Promise<boolean> {
      const rows = await sql.query(
        `update fixed_costs set status = 'active', active_from = $3
         where user_id = $1 and id = $2 and deleted_at is null and status = 'paused' returning 1`,
        [userId, id, today],
      );
      return rows.length === 1;
    },

    /** Soft-delete the fixed cost and remove its future PENDING occurrences. Paid history stays. */
    async softDelete(userId: string, id: string, today: LocalDate): Promise<boolean> {
      return sql.transaction(async (tx) => {
        const rows = await tx.query(
          'update fixed_costs set deleted_at = now() where user_id = $1 and id = $2 and deleted_at is null returning 1',
          [userId, id],
        );
        if (rows.length === 0) return false;
        await tx.query(
          `delete from fixed_cost_occurrences where user_id = $1 and fixed_cost_id = $2 and status = 'pending' and due_date >= $3`,
          [userId, id, today],
        );
        return true;
      });
    },

    // ── occurrences ──

    /** Idempotent: existing (fixed_cost_id, occurrence_key) rows are left untouched. Returns rows created. */
    async insertOccurrencesIfAbsent(
      rows: Array<Pick<FixedCostOccurrence, 'userId' | 'fixedCostId' | 'occurrenceKey' | 'dueDate' | 'amountSatang'>>,
    ): Promise<FixedCostOccurrence[]> {
      const created: FixedCostOccurrence[] = [];
      for (const o of rows) {
        const r = await sql.query<OccRow>(
          `insert into fixed_cost_occurrences (user_id, fixed_cost_id, occurrence_key, due_date, amount_satang)
           values ($1, $2, $3, $4, $5)
           on conflict (fixed_cost_id, occurrence_key) do nothing returning ${OCC_COLUMNS}`,
          [o.userId, o.fixedCostId, o.occurrenceKey, o.dueDate, o.amountSatang],
        );
        if (r[0]) created.push(mapOccurrence(r[0]));
      }
      return created;
    },

    async getOccurrence(userId: string, id: string): Promise<FixedCostOccurrence | null> {
      const rows = await sql.query<OccRow>(`select ${OCC_COLUMNS} from fixed_cost_occurrences where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? mapOccurrence(rows[0]) : null;
    },

    /** Occurrences relevant to a period: all PENDING due <= `through`, plus any due within [start, through]. */
    async listOccurrencesForPeriod(userId: string, start: LocalDate, through: LocalDate): Promise<FixedCostOccurrence[]> {
      const rows = await sql.query<OccRow>(
        `select ${occColumns('o')} from fixed_cost_occurrences o
         join fixed_costs f on f.id = o.fixed_cost_id and f.deleted_at is null
         where o.user_id = $1 and ((o.status = 'pending' and o.due_date <= $3) or o.due_date between $2 and $3)
         order by o.due_date`,
        [userId, start, through],
      );
      return rows.map(mapOccurrence);
    },

    async listOccurrencesOfFixedCost(userId: string, fixedCostId: string, limit = 6): Promise<FixedCostOccurrence[]> {
      const rows = await sql.query<OccRow>(
        `select ${OCC_COLUMNS} from fixed_cost_occurrences where user_id = $1 and fixed_cost_id = $2
         order by due_date desc limit $3`,
        [userId, fixedCostId, limit],
      );
      return rows.map(mapOccurrence);
    },

    async listPendingDueBetweenAllUsers(from: LocalDate, to: LocalDate): Promise<FixedCostOccurrence[]> {
      const rows = await sql.query<OccRow>(
        `select ${occColumns('o')} from fixed_cost_occurrences o
         join fixed_costs f on f.id = o.fixed_cost_id and f.deleted_at is null and f.status = 'active'
         join users u on u.line_user_id = o.user_id and u.is_following and u.notify_bill_reminders
         where o.status = 'pending' and o.due_date between $1 and $2
         order by o.user_id, o.due_date`,
        [from, to],
      );
      return rows.map(mapOccurrence);
    },

    async setOccurrenceStatus(
      userId: string,
      id: string,
      from: StoredOccurrenceStatus,
      to: StoredOccurrenceStatus,
    ): Promise<FixedCostOccurrence | null> {
      const rows = await sql.query<OccRow>(
        `update fixed_cost_occurrences set status = $4, resolved_at = case when $4 = 'pending' then null else now() end
         where user_id = $1 and id = $2 and status = $3 returning ${OCC_COLUMNS}`,
        [userId, id, from, to],
      );
      return rows[0] ? mapOccurrence(rows[0]) : null;
    },

    /** Remove future pending occurrences (used when pausing or editing a schedule). */
    async deleteFuturePending(userId: string, fixedCostId: string, fromDate: LocalDate): Promise<number> {
      const rows = await sql.query(
        `delete from fixed_cost_occurrences where user_id = $1 and fixed_cost_id = $2 and status = 'pending' and due_date >= $3 returning 1`,
        [userId, fixedCostId, fromDate],
      );
      return rows.length;
    },
  };
}
export type FixedCostRepo = ReturnType<typeof fixedCostRepo>;
