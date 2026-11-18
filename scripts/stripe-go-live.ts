/**
 * Prepare Stripe LIVE mode for ShikSheek (run once, after the Stripe account is activated):
 *   1. checks the live account can take charges
 *   2. creates (or reuses) a "ShikSheek PromptPay only" payment method configuration
 *   3. creates the live webhook endpoint → payment-webhook (signing secret is shown only once by Stripe)
 *   4. writes STRIPE_SECRET_KEY / STRIPE_PAYMENT_METHOD_CONFIG / STRIPE_WEBHOOK_SECRET to .env.stripe-live (gitignored)
 *
 * Usage: put STRIPE_LIVE_SECRET_KEY=sk_live_… in .env.production, then
 *   node --env-file=.env.production scripts/stripe-go-live.ts
 * Never prints secret values.
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const WEBHOOK_URL = 'https://ozmannorrtzrvdxothtf.supabase.co/functions/v1/payment-webhook';
const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const PMC_NAME = 'ShikSheek PromptPay only';
const OUT = '.env.stripe-live';

const key = process.env.STRIPE_LIVE_SECRET_KEY;
if (!key?.startsWith('sk_live_') && !key?.startsWith('rk_live_')) throw new Error('Set STRIPE_LIVE_SECRET_KEY=sk_live_… in .env.production first');
if (existsSync(OUT)) throw new Error(`${OUT} already exists — delete it to re-run`);

async function stripe(method: 'GET' | 'POST', path: string, params?: URLSearchParams): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(params ? { body: params } : {}),
  });
  const json = (await res.json()) as Record<string, any>;
  if (json.error) throw new Error(`Stripe ${path}: ${json.error.message}`);
  return json;
}

// 1. account
const acct = await stripe('GET', '/account');
console.log(`account: country=${acct.country} charges_enabled=${acct.charges_enabled} payouts_enabled=${acct.payouts_enabled}`);
if (acct.country !== 'TH') throw new Error('PromptPay needs a Thailand Stripe account');
if (!acct.charges_enabled) throw new Error('Account not activated yet: finish "Activate payments" in the Stripe Dashboard, then re-run');

// 2. PromptPay-only configuration (reuse by name)
const configs = await stripe('GET', '/payment_method_configurations?limit=100');
let pmc = (configs.data as Array<Record<string, any>>).find((c) => c.name === PMC_NAME && c.active);
if (!pmc) {
  const p = new URLSearchParams({ name: PMC_NAME, 'promptpay[display_preference][preference]': 'on' });
  for (const m of ['card', 'apple_pay', 'google_pay', 'link', 'alipay', 'wechat_pay', 'grabpay', 'paypal', 'klarna', 'cashapp', 'amazon_pay']) {
    p.set(`${m}[display_preference][preference]`, 'off');
  }
  // drop methods this account does not offer at all, then retry
  for (let i = 0; i < 12; i++) {
    try {
      pmc = await stripe('POST', '/payment_method_configurations', p);
      break;
    } catch (e) {
      const m = /(\w+)\[display_preference\]/.exec(String(e))?.[1];
      if (!m || !p.has(`${m}[display_preference][preference]`)) throw e;
      p.delete(`${m}[display_preference][preference]`);
    }
  }
}
if (!pmc) throw new Error('could not create the payment method configuration');
if (!pmc.promptpay?.available) throw new Error('PromptPay is not available on this live account yet (check Dashboard → Payment methods)');
console.log(`payment method configuration: ${pmc.id} (PromptPay ${pmc.promptpay.display_preference?.value}, card ${pmc.card?.display_preference?.value ?? 'n/a'})`);

// 3. webhook endpoint (the secret is only returned on creation)
const hooks = await stripe('GET', '/webhook_endpoints?limit=100');
if ((hooks.data as Array<Record<string, any>>).some((h) => h.url === WEBHOOK_URL)) {
  throw new Error('A live webhook for payment-webhook already exists. Delete it in the Dashboard (or roll its secret) and re-run.');
}
const hp = new URLSearchParams({ url: WEBHOOK_URL, description: 'ShikSheek payments' });
EVENTS.forEach((e, i) => hp.set(`enabled_events[${i}]`, e));
const hook = await stripe('POST', '/webhook_endpoints', hp);
console.log(`webhook endpoint: ${hook.id} (${hook.status})`);

// 4. write secrets locally (gitignored) — the deploy step pushes them to Supabase
writeFileSync(OUT, `STRIPE_SECRET_KEY=${key}\nSTRIPE_PAYMENT_METHOD_CONFIG=${pmc.id}\nSTRIPE_WEBHOOK_SECRET=${hook.secret}\n`, { mode: 0o600 });
appendFileSync(OUT, `# created ${new Date().toISOString()}\n`);
console.log(`wrote ${OUT} (3 values). Next: npx supabase secrets set --env-file ${OUT}`);
