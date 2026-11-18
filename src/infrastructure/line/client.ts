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
  /** Download a user-sent image/file. null if unavailable or larger than maxBytes. */
  getContent(messageId: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Link a rich menu to one user (overrides the channel default). */
  linkRichMenu(userId: string, richMenuId: string): Promise<void>;
  /** Rich menu id behind an alias, or null if the alias does not exist. */
  getRichMenuIdByAlias(aliasId: string): Promise<string | null>;
}

export class LineApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly endpoint: string;
  constructor(status: number, body: string, endpoint: string) {
    super(`LINE API ${endpoint} failed with ${status}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
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
    async getContent(messageId, maxBytes) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
          headers: { Authorization: `Bearer ${channelAccessToken}` },
        });
        if (res.status === 202) {
          await new Promise((r) => setTimeout(r, 1500)); // content still being prepared
          continue;
        }
        if (!res.ok) return null;
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > maxBytes) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > maxBytes) return null;
        return { bytes, contentType: (res.headers.get('content-type') ?? '').split(';')[0]!.trim() };
      }
      return null;
    },
    async linkRichMenu(userId, richMenuId) {
      const path = `/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`;
      const res = await fetchImpl(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${channelAccessToken}` } });
      if (!res.ok) throw new LineApiError(res.status, await res.text(), path);
    },
    async getRichMenuIdByAlias(aliasId) {
      const res = await fetchImpl(`${API}/v2/bot/richmenu/alias/${encodeURIComponent(aliasId)}`, { headers: { Authorization: `Bearer ${channelAccessToken}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new LineApiError(res.status, await res.text(), '/v2/bot/richmenu/alias');
      return ((await res.json()) as { richMenuId?: string }).richMenuId ?? null;
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
