/**
 * LINE webhook entry: verify signature on the RAW body → parse → de-duplicate → route.
 * Runtime-agnostic (used by the Supabase Edge Function and by tests).
 */
import { verifyLineSignature } from '../infrastructure/line/signature.ts';
import { parseLineEvent, webhookBodySchema } from '../infrastructure/line/webhook-schema.ts';
import type { AppDeps } from '../presentation/line/context.ts';
import { routeEvent } from '../presentation/line/router.ts';

export interface WebhookResult {
  status: number;
  body: string;
  /** Work to finish after responding (processing events). */
  work: Promise<void>;
}

export async function handleWebhookRequest(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
  deps: AppDeps,
): Promise<WebhookResult> {
  const done = Promise.resolve();
  if (!(await verifyLineSignature(channelSecret, rawBody, signature))) {
    deps.log.warn('invalid_signature');
    return { status: 401, body: 'invalid signature', work: done };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: 'invalid json', work: done };
  }
  const body = webhookBodySchema.safeParse(json);
  if (!body.success) return { status: 400, body: 'invalid body', work: done };

  // LINE "Verify" sends an empty events array.
  const work = (async () => {
    for (const raw of body.data.events) {
      const event = parseLineEvent(raw);
      const id = event.type === 'other' ? event.webhookEventId : event.webhookEventId;
      if (event.type !== 'other' && event.mode === 'standby') continue;
      if (id) {
        const first = await deps.repos.webhookEvents.claim(id, event.type === 'other' ? event.originalType : event.type).catch((e) => {
          deps.log.error('claim_failed', { error: e instanceof Error ? e.message : String(e) });
          return false;
        });
        if (!first) {
          deps.log.info('duplicate_event_skipped', { eventType: event.type });
          continue;
        }
      }
      await routeEvent(event, deps); // sequential: preserves per-user ordering
    }
  })();

  return { status: 200, body: 'ok', work };
}
