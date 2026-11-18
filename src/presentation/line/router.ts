/**
 * Routes one parsed LINE event to its handler and sends the reply.
 */
import { bangkokToday } from '../../domain/dates.ts';
import type { LineEvent, PostbackEvent, TextMessageEvent } from '../../infrastructure/line/webhook-schema.ts';
import { isTextMessage, userIdOf } from '../../infrastructure/line/webhook-schema.ts';
import type { Message } from '../../infrastructure/line/messages.ts';
import { redactUserId, type AppDeps, type HandlerContext } from './context.ts';
import { errorMessage, mascotSays, staleActionMessage, welcomeMessage } from './flex/common.ts';
import { pb } from './flex/actions.ts';
import { postbackHandlers } from './handlers/postback-handlers.ts';
import { handleText } from './handlers/text-handler.ts';
import { showDashboard } from './handlers/views.ts';
import { handleDocumentMessage } from './handlers/media.ts';
import { PlanLimitError } from '../../application/services/entitlement-service.ts';
import { planLimitMessage } from './flex/plans.ts';
import { decodePostback, type ActionName, type ParsedAction } from './postback.ts';

export async function dispatchPostback(ctx: HandlerContext, parsed: ParsedAction): Promise<Message[]> {
  const handler = postbackHandlers[parsed.action as ActionName] as (c: HandlerContext, p: unknown) => Promise<Message[]>;
  return handler(ctx, parsed.params);
}

/** Produce the reply for an event (no I/O to LINE). Exposed for tests. */
export async function buildReply(event: LineEvent, deps: AppDeps): Promise<Message[]> {
  try {
    return await buildReplyInner(event, deps);
  } catch (e) {
    // A plan limit anywhere in a handler becomes a friendly upgrade card, never an error.
    if (e instanceof PlanLimitError) return [planLimitMessage(e)];
    throw e;
  }
}

async function buildReplyInner(event: LineEvent, deps: AppDeps): Promise<Message[]> {
  const userId = userIdOf(event);
  if (!userId) return []; // groups/rooms and unknown events are ignored

  const now = deps.clock();
  const ctx: HandlerContext = { userId, now, today: bangkokToday(now), deps };

  if (event.type === 'unfollow') {
    await deps.repos.users.ensure(userId);
    await deps.repos.users.setFollowing(userId, false);
    return [];
  }

  if (event.type === 'follow') {
    const profile = await deps.line.getProfile(userId).catch(() => null);
    const { user, created } = await deps.repos.users.ensure(userId, profile?.displayName ?? null);
    if (!created) {
      await deps.repos.users.setFollowing(userId, true);
      if (profile?.displayName) await deps.repos.users.setDisplayName(userId, profile.displayName);
      if (user.onboarding === 'done') {
        return [mascotSays(`ยินดีต้อนรับกลับมา${profile?.displayName ? ` ${profile.displayName}` : ''}! คิดถึงนะ 🐔`, 'celebrating'), ...(await showDashboard(ctx))];
      }
    }
    return [welcomeMessage(profile?.displayName ?? user.displayName)];
  }

  // Any other event from a user we have never seen (e.g. data deleted, then a message): recreate quietly.
  const { created } = await deps.repos.users.ensure(userId);
  if (created) {
    const profile = await deps.line.getProfile(userId).catch(() => null);
    if (profile?.displayName) await deps.repos.users.setDisplayName(userId, profile.displayName);
  }

  if (event.type === 'postback') {
    const e = event as PostbackEvent;
    const parsed = decodePostback(e.postback.data, e.postback.params);
    if (!parsed) return [staleActionMessage()];
    return dispatchPostback(ctx, parsed);
  }

  if (isTextMessage(event)) {
    const replies = await handleText(ctx, (event as TextMessageEvent).message.text);
    if (created) return [welcomeMessage(null), ...replies].slice(0, 5);
    return replies;
  }

  if (event.type === 'message') {
    const m = (event as { message: { type: string; id: string; fileName?: string } }).message;
    if (m.type === 'image') return handleDocumentMessage(ctx, m.id, 'image');
    if (m.type === 'file' && /.pdf$/i.test(m.fileName ?? '')) return handleDocumentMessage(ctx, m.id, 'pdf');
    if (m.type === 'audio') {
      return [mascotSays('ตอนนี้ยังฟังข้อความเสียงไม่ได้น้า 🎙️ ลองกดไมค์บนคีย์บอร์ดมือถือแล้วพูด "กินข้าว 65" ระบบจะพิมพ์ให้เอง', 'thinking')];
    }
    return [mascotSays('ชิกชิกอ่านได้ทั้งข้อความ สลิป (รูป) และไฟล์ PDF นะ ลองส่งมาดู 🐔', 'thinking', [pb('วิธีใช้', 'help')])];
  }
  return [];
}

/** Build and send the reply; on failure send a friendly error instead. */
export async function routeEvent(event: LineEvent, deps: AppDeps): Promise<void> {
  const replyToken = 'replyToken' in event ? (event as { replyToken?: string }).replyToken : undefined;
  let messages: Message[];
  try {
    messages = await buildReply(event, deps);
  } catch (err) {
    const userId = userIdOf(event);
    deps.log.error('handler_failed', {
      eventType: event.type,
      user: userId ? redactUserId(userId) : null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    messages = [errorMessage()];
  }
  if (replyToken && messages.length) {
    try {
      await deps.line.reply(replyToken, messages);
    } catch (err) {
      deps.log.error('reply_failed', { eventType: event.type, error: err instanceof Error ? err.message : String(err) });
      // Slow document reads can outlive the reply token: fall back to a push so the result isn't lost.
      const userId = userIdOf(event);
      const isDocument = event.type === 'message' && ['image', 'file'].includes((event as { message: { type: string } }).message.type);
      if (userId && isDocument) {
        await deps.line.push(userId, messages).catch((e) => deps.log.error('push_fallback_failed', { error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }
}
