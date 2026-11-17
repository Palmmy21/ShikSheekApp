/**
 * Create the ShikSheek Rich Menu, upload its image and make it the default for all users.
 *   node scripts/build-rich-menu.ts   # (re)generate the image first if TILES changed
 *   node scripts/setup-rich-menu.ts
 * Safe to re-run: older menus with the same name are deleted after the new one is live.
 * Needs LINE_CHANNEL_ACCESS_TOKEN in .env.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RICH_MENU_NAME, richMenuDefinition } from '../src/presentation/line/rich-menu/definition.ts';
import { requireEnv } from './lib/env.ts';

const token = requireEnv('LINE_CHANNEL_ACCESS_TOKEN');
const auth = { Authorization: `Bearer ${token}` };

async function call(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const definition = richMenuDefinition();
await call('https://api.line.me/v2/bot/richmenu/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(definition) });
console.log('✓ definition valid');

const { richMenuId } = await call('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(definition) });
console.log(`✓ created ${richMenuId}`);

const image = readFileSync(join(import.meta.dirname, '..', 'assets/rich-menu/rich-menu.jpg'));
await call(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: image });
console.log('✓ image uploaded');

await call(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
console.log('✓ set as default for all users');

const { richmenus } = (await call('https://api.line.me/v2/bot/richmenu/list')) as { richmenus: Array<{ richMenuId: string; name: string }> };
for (const m of richmenus.filter((m) => m.name === RICH_MENU_NAME && m.richMenuId !== richMenuId)) {
  await call(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' });
  console.log(`✓ removed old menu ${m.richMenuId}`);
}
console.log('\nDone. Open the LINE chat to see the menu (may take a minute to refresh).');
