import type { Sql } from '../sql.ts';

export interface PendingAction<P = unknown> {
  id: string;
  userId: string;
  kind: string;
  payload: P;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: string;
}

interface PendingRow {
  id: string;
  user_id: string;
  kind: string;
  payload: unknown;
  status: PendingAction['status'];
  expires_at: unknown;
}

const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
const mapPending = <P>(r: PendingRow): PendingAction<P> => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  payload: parseJson(r.payload) as P,
  status: r.status,
  expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
});

const PENDING_COLUMNS = 'id, user_id, kind, payload, status, expires_at';

/** Drafts awaiting confirmation. Status transitions are conditional updates → double taps are safe. */
export function pendingActionRepo(sql: Sql) {
  return {
    async create<P>(userId: string, kind: string, payload: P, ttlMinutes: number): Promise<PendingAction<P>> {
      const rows = await sql.query<PendingRow>(
        `insert into pending_actions (user_id, kind, payload, expires_at)
         values ($1, $2, $3::jsonb, now() + make_interval(mins => $4)) returning ${PENDING_COLUMNS}`,
        [userId, kind, JSON.stringify(payload), ttlMinutes],
      );
      return mapPending<P>(rows[0]!);
    },
    async get<P>(userId: string, id: string): Promise<PendingAction<P> | null> {
      const rows = await sql.query<PendingRow>(`select ${PENDING_COLUMNS} from pending_actions where user_id = $1 and id = $2`, [userId, id]);
      return rows[0] ? mapPending<P>(rows[0]) : null;
    },
    /** Update the draft payload while still pending and unexpired. */
    async updatePayload<P>(userId: string, id: string, payload: P): Promise<PendingAction<P> | null> {
      const rows = await sql.query<PendingRow>(
        `update pending_actions set payload = $3::jsonb
         where user_id = $1 and id = $2 and status = 'pending' and expires_at > now() returning ${PENDING_COLUMNS}`,
        [userId, id, JSON.stringify(payload)],
      );
      return rows[0] ? mapPending<P>(rows[0]) : null;
    },
    /**
     * Atomically move pending → confirmed/cancelled. Returns the action only for the caller that won;
     * a second tap (or an expired draft) gets null.
     */
    async resolve<P>(userId: string, id: string, to: 'confirmed' | 'cancelled'): Promise<PendingAction<P> | null> {
      const rows = await sql.query<PendingRow>(
        `update pending_actions set status = $3, resolved_at = now()
         where user_id = $1 and id = $2 and status = 'pending' and expires_at > now() returning ${PENDING_COLUMNS}`,
        [userId, id, to],
      );
      return rows[0] ? mapPending<P>(rows[0]) : null;
    },
    async cancelAllPending(userId: string, kind?: string): Promise<void> {
      await sql.query(
        `update pending_actions set status = 'cancelled', resolved_at = now()
         where user_id = $1 and status = 'pending' and ($2::text is null or kind = $2)`,
        [userId, kind ?? null],
      );
    },
    async purgeResolvedOlderThan(days: number): Promise<void> {
      await sql.query(
        `delete from pending_actions where (status <> 'pending' or expires_at < now()) and created_at < now() - make_interval(days => $1)`,
        [days],
      );
    },
  };
}
export type PendingActionRepo = ReturnType<typeof pendingActionRepo>;

export interface ConversationState<C = Record<string, unknown>> {
  state: string;
  context: C;
}

export function conversationRepo(sql: Sql) {
  return {
    async get<C = Record<string, unknown>>(userId: string): Promise<ConversationState<C> | null> {
      const rows = await sql.query<{ state: string; context: unknown }>(
        'select state, context from conversation_states where user_id = $1 and expires_at > now()',
        [userId],
      );
      return rows[0] ? { state: rows[0].state, context: parseJson(rows[0].context) as C } : null;
    },
    async set(userId: string, state: string, context: Record<string, unknown> = {}, ttlMinutes = 15): Promise<void> {
      await sql.query(
        `insert into conversation_states (user_id, state, context, expires_at, updated_at)
         values ($1, $2, $3::jsonb, now() + make_interval(mins => $4), now())
         on conflict (user_id) do update set state = excluded.state, context = excluded.context,
           expires_at = excluded.expires_at, updated_at = now()`,
        [userId, state, JSON.stringify(context), ttlMinutes],
      );
    },
    async clear(userId: string): Promise<void> {
      await sql.query('delete from conversation_states where user_id = $1', [userId]);
    },
  };
}
export type ConversationRepo = ReturnType<typeof conversationRepo>;

/** Scheduler idempotency: `claim` is true only the first time for (job, runKey, userId). */
export function jobRunRepo(sql: Sql) {
  return {
    async claim(job: string, runKey: string, userId = ''): Promise<boolean> {
      const rows = await sql.query(
        `insert into job_runs (job, run_key, user_id) values ($1, $2, $3) on conflict do nothing returning 1`,
        [job, runKey, userId],
      );
      return rows.length === 1;
    },
    async release(job: string, runKey: string, userId = ''): Promise<void> {
      await sql.query('delete from job_runs where job = $1 and run_key = $2 and user_id = $3', [job, runKey, userId]);
    },
  };
}
export type JobRunRepo = ReturnType<typeof jobRunRepo>;
