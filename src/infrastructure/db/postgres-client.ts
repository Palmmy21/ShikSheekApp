/**
 * Production SQL adapter over postgres.js (works on Deno/Supabase Edge Functions and Node).
 * Use the Supabase *transaction pooler* URL (port 6543); prepared statements are disabled for it.
 */
import postgres from 'postgres';
import type { Sql } from './sql.ts';

type PgClient = ReturnType<typeof postgres>;
type Queryable = Pick<PgClient, 'unsafe'>;

function adapt(client: Queryable, root: PgClient, inTransaction: boolean): Sql {
  const self: Sql = {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const rows = await client.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async transaction<R>(fn: (tx: Sql) => Promise<R>) {
      if (inTransaction) return fn(self);
      return (await root.begin((tx) => fn(adapt(tx as unknown as Queryable, root, true)))) as R;
    },
  };
  return self;
}

export function createPostgresSql(databaseUrl: string): Sql & { end(): Promise<void> } {
  const client = postgres(databaseUrl, {
    prepare: false, // required by the Supabase transaction pooler
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return Object.assign(adapt(client, client, false), { end: () => client.end({ timeout: 5 }) });
}
