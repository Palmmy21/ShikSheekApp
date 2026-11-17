/**
 * In-process Postgres (PGlite) with all Supabase migrations applied.
 * Lets integration tests exercise the real schema, constraints and SQL functions without Docker.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '../../src/infrastructure/db/sql.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** Migrations that need Supabase-only extensions (pg_cron, pg_net) are skipped in tests. */
const SUPABASE_ONLY = /_supabase_only\.sql$/;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !SUPABASE_ONLY.test(f))
    .sort();
}

type Queryable = Pick<PGlite, 'query'>;

function adapt(db: Queryable, root: PGlite, inTransaction = false): Sql {
  const self: Sql = {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const res = await db.query<T>(text, params as unknown[]);
      return res.rows;
    },
    async transaction<R>(fn: (tx: Sql) => Promise<R>) {
      // Nested calls join the outer transaction (same semantics as the production client).
      if (inTransaction) return fn(self);
      return root.transaction(async (tx) => fn(adapt(tx as unknown as Queryable, root, true)));
    },
  };
  return self;
}

export interface TestDb {
  sql: Sql;
  pg: PGlite;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  for (const file of migrationFiles()) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return { sql: adapt(pg, pg), pg, close: () => pg.close() };
}

/** Deterministic, schema-valid LINE user ids for tests. */
export function testUserId(n: number): string {
  return `U${n.toString(16).padStart(32, '0')}`;
}
