/**
 * Shared bootstrap for all Edge Functions: config, DB pool and app dependencies are created once per
 * isolate and reused across invocations.
 */
import { createAppDeps } from '../../../src/app.ts';
import { loadConfig, type AppConfig } from '../../../src/config/env.ts';
import { createPostgresSql } from '../../../src/infrastructure/db/postgres-client.ts';
import type { AppDeps } from '../../../src/presentation/line/context.ts';

let cached: { config: AppConfig; deps: AppDeps } | null = null;

export function bootstrap(): { config: AppConfig; deps: AppDeps } {
  if (cached) return cached;
  const config = loadConfig((k) => Deno.env.get(k));
  const sql = createPostgresSql(config.SUPABASE_DB_URL);
  cached = { config, deps: createAppDeps(sql, config) };
  return cached;
}

/** Keep the isolate alive for background work after the response is sent. */
export function runInBackground(work: Promise<unknown>): Promise<unknown> | void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) {
    runtime.waitUntil(work);
    return;
  }
  return work;
}
