/**
 * LINE Messaging API client (fetch-based; no SDK so it runs identically on Deno and Node).
 */
import type { Message } from './messages.ts';
import { MAX_MESSAGES_PER_REPLY } from './messages.ts';

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  language?: string;
}

export interface LineClient {
  reply(replyToken: string, messages: Message[]): Promise<void>;
  /** `retryKey` (UUID) makes pushes idempotent on LINE's side for 24h. */
  push(to: string, messages: Message[], retryKey?: string): Promise<void>;
  getProfile(userId: string): Promise<LineProfile | null>;
  showLoading(userId: string, seconds?: number): Promise<void>;
}

export class LineApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly endpoint: string,
  ) {
    super(`LINE API ${endpoint} failed with ${status}`);
    this.name = 'LineApiError';
  }
}

const API = 'https://api.line.me';

export function createLineClient(channelAccessToken: string, fetchImpl: typeof fetch = fetch): LineClient {
  if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set');

  async function call(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const res = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    // 409 on push with an already-accepted retry key means "already sent" — treat as success.
    if (!res.ok && !(res.status === 409 && extraHeaders['X-Line-Retry-Key'])) {
      throw new LineApiError(res.status, await res.text(), path);
    }
    return res;
  }

  return {
    async reply(replyToken, messages) {
      if (messages.length === 0) return;
      await call('/v2/bot/message/reply', { replyToken, messages: messages.slice(0, MAX_MESSAGES_PER_REPLY) });
    },
    async push(to, messages, retryKey) {
      if (messages.length === 0) return;
      await call(
        '/v2/bot/message/push',
        { to, messages: messages.slice(0, MAX_MESSAGES_PER_REPLY) },
        retryKey ? { 'X-Line-Retry-Key': retryKey } : {},
      );
    },
    async getProfile(userId) {
      const res = await fetchImpl(`${API}/v2/bot/profile/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${channelAccessToken}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as LineProfile;
    },
    async showLoading(userId, seconds = 5) {
      try {
        await call('/v2/bot/chat/loading/start', { chatId: userId, loadingSeconds: seconds });
      } catch {
        // purely cosmetic
      }
    },
  };
}
