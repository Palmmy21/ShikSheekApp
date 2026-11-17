/**
 * Minimal SQL port used by all repositories.
 *
 * Production: postgres.js over SUPABASE_DB_URL (see postgres-client.ts, Phase 3).
 * Tests: PGlite (in-process Postgres) via tests/helpers/db.ts.
 *
 * Repositories write plain parameterised SQL ($1, $2 …) so the exact same queries
 * run against the real database in tests.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
}

/** int8/numeric columns may arrive as string or bigint depending on the driver. */
export function toSafeInt(value: unknown, label = 'value'): number {
  const n = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isSafeInteger(n)) throw new TypeError(`${label} is not a safe integer: ${String(value)}`);
  return n;
}

/** date columns may arrive as Date or 'YYYY-MM-DD' depending on the driver. */
export function toLocalDate(value: unknown): string {
  if (value instanceof Date) {
    // Drivers parse DATE as local-midnight; read back the calendar parts in UTC-agnostic way.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError(`Not a date: ${String(value)}`);
}

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
