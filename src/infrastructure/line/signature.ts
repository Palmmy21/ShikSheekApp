/**
 * LINE webhook signature verification.
 * x-line-signature = base64(HMAC-SHA256(channelSecret, rawRequestBody))
 * Must be computed over the RAW body bytes, before any JSON parsing.
 * Uses Web Crypto so it runs unchanged on Deno (Edge Functions) and Node >= 20.
 */

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeLineSignature(channelSecret: string, rawBody: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof rawBody === 'string' ? encoder.encode(rawBody) : rawBody;
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  return toBase64(new Uint8Array(sig));
}

export async function verifyLineSignature(
  channelSecret: string,
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
): Promise<boolean> {
  if (!channelSecret || !signatureHeader) return false;
  const expected = await computeLineSignature(channelSecret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim());
}
