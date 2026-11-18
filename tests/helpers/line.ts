import type { LineClient, LineProfile } from '../../src/infrastructure/line/client.ts';
import type { Message } from '../../src/infrastructure/line/messages.ts';
import { computeLineSignature } from '../../src/infrastructure/line/signature.ts';

export class FakeLineClient implements LineClient {
  replies: Array<{ replyToken: string; messages: Message[] }> = [];
  pushes: Array<{ to: string; messages: Message[]; retryKey?: string }> = [];
  profiles = new Map<string, LineProfile>();
  contents = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async reply(replyToken: string, messages: Message[]) {
    this.replies.push({ replyToken, messages });
  }
  async push(to: string, messages: Message[], retryKey?: string) {
    this.pushes.push({ to, messages, ...(retryKey ? { retryKey } : {}) });
  }
  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async showLoading() {}
  async getContent(messageId: string, maxBytes: number) {
    const c = this.contents.get(messageId);
    return c && c.bytes.byteLength <= maxBytes ? c : null;
  }

  lastReply(): Message[] {
    return this.replies.at(-1)?.messages ?? [];
  }
  reset() {
    this.replies = [];
    this.pushes = [];
  }
}

export const CHANNEL_SECRET = 'test-channel-secret-1234567890';

let eventSeq = 0;
export function nextEventId(): string {
  return `01TEST${String(++eventSeq).padStart(20, '0')}`;
}

export function textEvent(userId: string, text: string, webhookEventId = nextEventId()) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    webhookEventId,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt-${webhookEventId}`,
    message: { id: `m-${webhookEventId}`, type: 'text', quoteToken: 'q', text },
  };
}

export function postbackEvent(userId: string, data: string, params?: Record<string, string>, webhookEventId = nextEventId()) {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    webhookEventId,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt-${webhookEventId}`,
    postback: { data, ...(params ? { params } : {}) },
  };
}

export function followEvent(userId: string, webhookEventId = nextEventId()) {
  return {
    type: 'follow',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId },
    webhookEventId,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt-${webhookEventId}`,
    follow: { isUnblocked: false },
  };
}

export async function signedBody(events: unknown[]): Promise<{ body: string; signature: string }> {
  const body = JSON.stringify({ destination: 'Uxxxxxxxx', events });
  return { body, signature: await computeLineSignature(CHANNEL_SECRET, body) };
}
