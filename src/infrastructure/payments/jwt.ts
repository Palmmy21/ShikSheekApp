/**
 * Minimal HS256 JWT (sign + verify) on WebCrypto, so it runs unchanged on Node and Deno.
 * Used for 2C2P PGW v4.5, where every request/response/notification is `{"payload": "<JWT>"}`
 * signed with the merchant secret key.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, k);
  }
  return k;
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const data = `${b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

/** Returns the payload when the signature is valid HS256 for `secret`, otherwise null. */
export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  if (typeof token !== 'string' || token.length > 20_000) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const headerBytes = fromB64url(h);
  const payloadBytes = fromB64url(p);
  const sig = fromB64url(s);
  if (!headerBytes || !payloadBytes || !sig) return null;
  try {
    const header = JSON.parse(dec.decode(headerBytes)) as { alg?: string };
    if (header.alg !== 'HS256') return null; // never accept "none" or other algorithms
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(payloadBytes));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
