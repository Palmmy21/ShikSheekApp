/**
 * Validate every message template against LINE's official validator.
 *   node scripts/validate-flex.ts
 * Uses POST https://api.line.me/v2/bot/message/validate/reply (does not send anything).
 * Needs LINE_CHANNEL_ACCESS_TOKEN in .env.
 */
import { buildSamples } from './lib/flex-samples.ts';
import { requireEnv } from './lib/env.ts';

const token = requireEnv('LINE_CHANNEL_ACCESS_TOKEN');
let failed = 0;
for (const [name, messages] of Object.entries(buildSamples())) {
  const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (res.ok) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}: ${res.status} ${await res.text()}`);
  }
}
if (failed) {
  console.error(`\n${failed} template(s) rejected by LINE`);
  process.exit(1);
}
console.log('\nAll templates accepted by LINE ✓');
