/**
 * Zod schemas for the subset of LINE webhook events ShikSheek handles.
 * Unknown event types are parsed as `other` and ignored rather than rejected,
 * so LINE adding new event types never breaks the webhook.
 * Spec: https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
 */
import { z } from 'zod';

const userSource = z.object({ type: z.literal('user'), userId: z.string().min(1) });
const otherSource = z.object({ type: z.enum(['group', 'room']), userId: z.string().optional() }).passthrough();
const source = z.union([userSource, otherSource]);

const base = {
  webhookEventId: z.string().min(1).max(64),
  timestamp: z.number(),
  mode: z.enum(['active', 'standby']).default('active'),
  source,
  deliveryContext: z.object({ isRedelivery: z.boolean() }).default({ isRedelivery: false }),
};

export const followEventSchema = z.object({ ...base, type: z.literal('follow'), replyToken: z.string() });
export const unfollowEventSchema = z.object({ ...base, type: z.literal('unfollow') });

export const textMessageEventSchema = z.object({
  ...base,
  type: z.literal('message'),
  replyToken: z.string(),
  message: z.object({ type: z.literal('text'), id: z.string(), text: z.string().max(5000) }),
});

export const nonTextMessageEventSchema = z.object({
  ...base,
  type: z.literal('message'),
  replyToken: z.string(),
  message: z.object({ type: z.string(), id: z.string() }).passthrough(),
});

export const postbackEventSchema = z.object({
  ...base,
  type: z.literal('postback'),
  replyToken: z.string(),
  postback: z.object({
    data: z.string().max(300),
    params: z.record(z.string()).optional(),
  }),
});

export type FollowEvent = z.infer<typeof followEventSchema>;
export type UnfollowEvent = z.infer<typeof unfollowEventSchema>;
export type TextMessageEvent = z.infer<typeof textMessageEventSchema>;
export type NonTextMessageEvent = z.infer<typeof nonTextMessageEventSchema>;
export type PostbackEvent = z.infer<typeof postbackEventSchema>;
export interface OtherEvent {
  type: 'other';
  originalType: string;
  webhookEventId: string | null;
}

export type LineEvent = FollowEvent | UnfollowEvent | TextMessageEvent | NonTextMessageEvent | PostbackEvent | OtherEvent;

export const webhookBodySchema = z.object({
  destination: z.string(),
  events: z.array(z.unknown()),
});

/** Parse one raw event; never throws. */
export function parseLineEvent(raw: unknown): LineEvent {
  const type = (raw as { type?: unknown })?.type;
  const tryParse = <S extends z.ZodTypeAny>(schema: S): z.output<S> | null => {
    const r = schema.safeParse(raw);
    return r.success ? r.data : null;
  };
  let parsed: LineEvent | null = null;
  switch (type) {
    case 'follow':
      parsed = tryParse(followEventSchema);
      break;
    case 'unfollow':
      parsed = tryParse(unfollowEventSchema);
      break;
    case 'message':
      parsed = tryParse(textMessageEventSchema) ?? tryParse(nonTextMessageEventSchema);
      break;
    case 'postback':
      parsed = tryParse(postbackEventSchema);
      break;
  }
  if (parsed) return parsed;
  const id = (raw as { webhookEventId?: unknown })?.webhookEventId;
  return { type: 'other', originalType: String(type), webhookEventId: typeof id === 'string' ? id : null };
}

export function isTextMessage(e: LineEvent): e is TextMessageEvent {
  return e.type === 'message' && (e as TextMessageEvent).message.type === 'text';
}

export function userIdOf(e: LineEvent): string | null {
  if (e.type === 'other') return null;
  return e.source.type === 'user' ? e.source.userId : null;
}
