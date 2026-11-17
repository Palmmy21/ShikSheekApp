/**
 * Upload mascot images, logo and rich menu preview to a PUBLIC Supabase Storage bucket "assets".
 *   node scripts/upload-assets.ts
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (local only — never deploy the service key).
 * Then set PUBLIC_ASSET_BASE_URL = <SUPABASE_URL>/storage/v1/object/public/assets
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireEnv } from './lib/env.ts';

const url = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const ROOT = join(import.meta.dirname, '..');
const headers = { Authorization: `Bearer ${key}`, apikey: key };

const bucket = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'assets', name: 'assets', public: true, allowed_mime_types: ['image/png', 'image/jpeg'], file_size_limit: 2_000_000 }),
});
if (bucket.ok) console.log('✓ created public bucket "assets"');
else if (bucket.status === 400 || bucket.status === 409) console.log('• bucket "assets" already exists');
else throw new Error(`bucket: ${bucket.status} ${await bucket.text()}`);

const files: Array<[string, string]> = [
  ...readdirSync(join(ROOT, 'assets/mascot')).filter((f) => f.endsWith('.png')).map((f) => [`assets/mascot/${f}`, `mascot/${f}`] as [string, string]),
  ['assets/branding/logo.png', 'branding/logo.png'],
  ['assets/rich-menu/rich-menu-preview.png', 'rich-menu/rich-menu-preview.png'],
];

for (const [local, remote] of files) {
  const res = await fetch(`${url}/storage/v1/object/assets/${remote}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': local.endsWith('.png') ? 'image/png' : 'image/jpeg', 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000' },
    body: readFileSync(join(ROOT, local)),
  });
  if (!res.ok) throw new Error(`${remote}: ${res.status} ${await res.text()}`);
  console.log(`✓ ${remote}`);
}
console.log(`\nPUBLIC_ASSET_BASE_URL=${url}/storage/v1/object/public/assets`);
