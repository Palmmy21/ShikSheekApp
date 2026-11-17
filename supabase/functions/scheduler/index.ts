/**
 * Scheduler endpoint, called hourly by pg_cron (see migration *_cron_supabase_only.sql).
 * Auth: `Authorization: Bearer <CRON_SECRET>`.  (verify_jwt = false)
 *
 * Manual run of specific jobs:
 *   curl -X POST "$URL/functions/v1/scheduler" -H "Authorization: Bearer $CRON_SECRET" \
 *        -H "Content-Type: application/json" -d '{"force":["daily_summary"]}'
 */
import { runScheduledJobs, SCHEDULE, type JobName } from '../../../src/application/jobs.ts';
import { timingSafeEqual } from '../../../src/infrastructure/line/signature.ts';
import { bootstrap } from '../_shared/bootstrap.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const { config, deps } = bootstrap();
  if (!config.CRON_SECRET) return new Response('CRON_SECRET not configured', { status: 500 });
  const auth = req.headers.get('authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${config.CRON_SECRET}`)) return new Response('unauthorized', { status: 401 });

  let force: JobName[] | undefined;
  try {
    const body = (await req.json()) as { force?: unknown };
    if (Array.isArray(body.force)) force = body.force.filter((j): j is JobName => typeof j === 'string' && j in SCHEDULE);
  } catch {
    // empty body = run whatever is due now
  }
  const reports = await runScheduledJobs(deps, new Date(), force);
  deps.log.info('scheduler_run', { reports });
  return Response.json({ ok: true, reports });
});
