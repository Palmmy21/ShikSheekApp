/**
 * Create the four plan-variant Rich Menus (free / trial / plus / pro), upload their images,
 * point the aliases shiksheek-<variant> at them and make "free" the channel default.
 *   node scripts/build-rich-menu.ts      # (re)generate images first if TILES/BAR changed
 *   node --env-file=.env.production scripts/setup-rich-menu.ts
 * Safe to re-run: aliases are moved to the new menus, then older ShikSheek menus are deleted.
 * Users are re-linked to their variant by the bot (follow / payment / hourly rich_menu_sync job).
 * Needs LINE_CHANNEL_ACCESS_TOKEN and LIFF_URL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RICH_MENU_VARIANTS, richMenuAlias, richMenuDefinition } from '../src/presentation/line/rich-menu/definition.ts';
import { requireEnv } from './lib/env.ts';

const token = requireEnv('LINE_CHANNEL_ACCESS_TOKEN');
const liffUrl = requireEnv('LIFF_URL');
const auth = { Authorization: `Bearer ${token}` };

async function call(url: string, init: RequestInit = {}, okStatuses: number[] = []) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const created: Record<string, string> = {};
for (const v of RICH_MENU_VARIANTS) {
  const def = richMenuDefinition(v, liffUrl);
  await call('https://api.line.me/v2/bot/richmenu/validate', json(def));
  const { body } = await call('https://api.line.me/v2/bot/richmenu', json(def));
  const id = body.richMenuId as string;
  await call(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: readFileSync(join(import.meta.dirname, '..', `assets/rich-menu/rich-menu-${v}.jpg`)),
  });
  // move (or create) the alias
  const alias = richMenuAlias(v);
  const upd = await call(`https://api.line.me/v2/bot/richmenu/alias/${alias}`, json({ richMenuId: id }), [400, 404]);
  if (upd.status !== 200) await call('https://api.line.me/v2/bot/richmenu/alias', json({ richMenuAliasId: alias, richMenuId: id }));
  created[v] = id;
  console.log(`✓ ${v}: ${id} (alias ${alias})`);
}

await call(`https://api.line.me/v2/bot/user/all/richmenu/${created.free}`, { method: 'POST' });
console.log('✓ "free" set as the channel default');

const keep = new Set(Object.values(created));
const { body } = await call('https://api.line.me/v2/bot/richmenu/list');
for (const m of (body.richmenus as Array<{ richMenuId: string; name: string }>).filter((m) => m.name.startsWith('ShikSheek') && !keep.has(m.richMenuId))) {
  await call(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' });
  console.log(`✓ removed old menu ${m.name}`);
}
console.log('\nDone. Users get their plan variant on their next follow/payment, or within the hour via rich_menu_sync.');
