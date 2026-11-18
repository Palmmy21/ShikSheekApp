/** External links used in bot messages (configured once at startup). */
let liffUrl: string | null = null;

export function configureLiffUrl(url: string | undefined | null): void {
  liffUrl = url ? url.replace(/\/+$/, '') : null;
}

/** https://liff.line.me/<id>[/<path>] or null when LIFF is not configured. */
export function liffLink(path = ''): string | null {
  if (!liffUrl) return null;
  return path ? `${liffUrl}/${path.replace(/^\/+/, '')}` : liffUrl;
}
