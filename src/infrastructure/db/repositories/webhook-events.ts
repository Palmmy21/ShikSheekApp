import type { Sql } from '../sql.ts';

/**
 * Webhook idempotency. `claim` returns true only for the first delivery of an event id.
 * If processing fails, `release` lets a LINE redelivery retry it.
 */
export function webhookEventRepo(sql: Sql) {
  return {
    async claim(webhookEventId: string, eventType: string): Promise<boolean> {
      const rows = await sql.query(
        `insert into webhook_events (webhook_event_id, event_type) values ($1, $2)
         on conflict (webhook_event_id) do nothing returning webhook_event_id`,
        [webhookEventId, eventType],
      );
      return rows.length === 1;
    },
    async release(webhookEventId: string): Promise<void> {
      await sql.query('delete from webhook_events where webhook_event_id = $1', [webhookEventId]);
    },
    async purgeOlderThan(days: number): Promise<number> {
      const rows = await sql.query(
        `delete from webhook_events where received_at < now() - make_interval(days => $1) returning 1`,
        [days],
      );
      return rows.length;
    },
  };
}
export type WebhookEventRepo = ReturnType<typeof webhookEventRepo>;
