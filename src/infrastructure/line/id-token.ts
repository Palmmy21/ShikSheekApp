/**
 * LIFF ID token verification via LINE's official endpoint
 * (POST https://api.line.me/oauth2/v2.1/verify). The token's `sub` is the LINE user id —
 * identical to the Messaging API user id when the LINE Login channel is in the same provider.
 * Results are cached in memory (keyed by a hash of the token) until the token expires.
 */
import { sha256Hex } from '../../application/services/privacy-service.ts';

export interface VerifiedIdentity {
  userId: string;
  name: string | null;
  expiresAt: number; // epoch ms
}

export type IdTokenVerifier = (idToken: string) => Promise<VerifiedIdentity | null>;

export function createIdTokenVerifier(channelId: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): IdTokenVerifier {
  const cache = new Map<string, VerifiedIdentity>();
  return async (idToken) => {
    if (!idToken || idToken.length > 4096 || idToken.split('.').length !== 3) return null;
    const key = await sha256Hex(idToken);
    const hit = cache.get(key);
    if (hit) {
      if (hit.expiresAt > now()) return hit;
      cache.delete(key);
    }
    const res = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sub?: string; name?: string; exp?: number; aud?: string };
    if (!body.sub || !/^U[0-9a-f]{32}$/.test(body.sub) || body.aud !== channelId || !body.exp) return null;
    const identity: VerifiedIdentity = { userId: body.sub, name: body.name ?? null, expiresAt: body.exp * 1000 };
    if (identity.expiresAt <= now()) return null;
    if (cache.size > 1000) cache.clear();
    cache.set(key, identity);
    return identity;
  };
}
