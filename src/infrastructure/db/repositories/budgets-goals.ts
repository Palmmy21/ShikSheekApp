import type { LocalDate } from '../../../domain/dates.ts';
import type { Budget, DreamKind, SavingsGoal, SavingsGoalStatus } from '../../../domain/entities/index.ts';
import { toSafeInt, type Sql } from '../sql.ts';

interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string;
  limit_satang: unknown;
}
const mapBudget = (r: BudgetRow): Budget => ({
  id: r.id,
  userId: r.user_id,
  categoryId: r.category_id,
  limitSatang: toSafeInt(r.limit_satang),
});

export function budgetRepo(sql: Sql) {
  return {
    async upsert(userId: string, categoryId: string, limitSatang: number): Promise<Budget> {
      const rows = await sql.query<BudgetRow>(
        `insert into budgets (user_id, category_id, limit_satang) values ($1, $2, $3)
         on conflict (user_id, category_id) do update set limit_satang = excluded.limit_satang
         returning id, user_id, category_id, limit_satang`,
        [userId, categoryId, limitSatang],
      );
      return mapBudget(rows[0]!);
    },
    async list(userId: string): Promise<Budget[]> {
      const rows = await sql.query<BudgetRow>(
        'select id, user_id, category_id, limit_satang from budgets where user_id = $1 order by category_id',
        [userId],
      );
      return rows.map(mapBudget);
    },
    async delete(userId: string, id: string): Promise<boolean> {
      const rows = await sql.query('delete from budgets where user_id = $1 and id = $2 returning 1', [userId, id]);
      return rows.length === 1;
    },
    async alertedThresholds(budgetId: string, periodStart: LocalDate): Promise<number[]> {
      const rows = await sql.query<{ threshold: number }>(
        'select threshold from budget_alerts where budget_id = $1 and period_start = $2',
        [budgetId, periodStart],
      );
      return rows.map((r) => Number(r.threshold));
    },
    /** Returns true only for the first caller to record this alert (idempotent under races). */
    async recordAlert(userId: string, budgetId: string, periodStart: LocalDate, threshold: number): Promise<boolean> {
      const rows = await sql.query(
        `insert into budget_alerts (user_id, budget_id, period_start, threshold) values ($1, $2, $3, $4)
         on conflict do nothing returning 1`,
        [userId, budgetId, periodStart, threshold],
      );
      return rows.length === 1;
    },
  };
}
export type BudgetRepo = ReturnType<typeof budgetRepo>;

interface GoalRow {
  id: string;
  user_id: string;
  name: string;
  target_satang: unknown;
  monthly_reserve_satang: unknown;
  target_date: string | null;
  dream: DreamKind | null;
  created_on: string;
  status: SavingsGoalStatus;
}
const GOAL_COLUMNS = `id, user_id, name, target_satang, monthly_reserve_satang, target_date::text as target_date, status, dream,
  to_char((created_at at time zone 'UTC') + interval '7 hours', 'YYYY-MM-DD') as created_on`;
const mapGoal = (r: GoalRow): SavingsGoal => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  targetSatang: toSafeInt(r.target_satang),
  monthlyReserveSatang: toSafeInt(r.monthly_reserve_satang),
  targetDate: r.target_date,
  dream: r.dream,
  createdOn: r.created_on,
  status: r.status,
});

export function goalRepo(sql: Sql) {
  return {
    async insert(g: Omit<SavingsGoal, 'id' | 'status' | 'createdOn'>): Promise<SavingsGoal> {
      const rows = await sql.query<GoalRow>(
        `insert into savings_goals (user_id, name, target_satang, monthly_reserve_satang, target_date, dream)
         values ($1, $2, $3, $4, $5, $6) returning ${GOAL_COLUMNS}`,
        [g.userId, g.name, g.targetSatang, g.monthlyReserveSatang, g.targetDate, g.dream ?? null],
      );
      return mapGoal(rows[0]!);
    },
    async get(userId: string, id: string): Promise<SavingsGoal | null> {
      const rows = await sql.query<GoalRow>(`select ${GOAL_COLUMNS} from savings_goals where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? mapGoal(rows[0]) : null;
    },
    async listActive(userId: string): Promise<SavingsGoal[]> {
      const rows = await sql.query<GoalRow>(
        `select ${GOAL_COLUMNS} from savings_goals where user_id = $1 and status <> 'archived' order by created_at`,
        [userId],
      );
      return rows.map(mapGoal);
    },
    async update(userId: string, id: string, patch: { targetSatang?: number; monthlyReserveSatang?: number; targetDate?: LocalDate }): Promise<boolean> {
      const rows = await sql.query(
        `update savings_goals set target_satang = coalesce($3::bigint, target_satang), monthly_reserve_satang = coalesce($4::bigint, monthly_reserve_satang),
           target_date = coalesce($5::date, target_date)
         where user_id = $1 and id = $2 returning 1`,
        [userId, id, patch.targetSatang ?? null, patch.monthlyReserveSatang ?? null, patch.targetDate ?? null],
      );
      return rows.length === 1;
    },

    async setStatus(userId: string, id: string, status: SavingsGoalStatus): Promise<boolean> {
      const rows = await sql.query('update savings_goals set status = $3 where user_id = $1 and id = $2 returning 1', [userId, id, status]);
      return rows.length === 1;
    },
  };
}
export type GoalRepo = ReturnType<typeof goalRepo>;
