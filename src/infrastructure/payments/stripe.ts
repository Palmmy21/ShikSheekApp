/**
 * Stripe Checkout (hosted page) with PromptPay — plain fetch, so it runs on Node and Deno.
 *
 * Flow: create a Checkout Session (mode=payment, THB) → user pays on checkout.stripe.com →
 * Stripe sends `checkout.session.completed` (signed) → we re-fetch the session server-side and
 * only grant when payment_status=paid with the exact amount.
 */
import { PaymentGatewayError, type PaymentGateway } from './gateway.ts';

const API = 'https://api.stripe.com/v1';
const enc = new TextEncoder();

export interface StripeOptions {
  secretKey: string;
  /** signing secret of the webhook endpoint (whsec_…); without it webhooks are rejected */
  webhookSecret?: string;
  /**
   * Optional payment method configuration (pmc_…) to pin which methods Checkout shows. Without it,
   * Checkout shows what is enabled in Dashboard → Settings → Payment methods (enable PromptPay there).
   */
  paymentMethodConfiguration?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

function form(data: Record<string, string | number | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** constant-time compare of two hex strings */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a `Stripe-Signature` header (v1 = HMAC-SHA256 of "t.body"), with a 5-minute tolerance. */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

export function createStripeGateway(o: StripeOptions): PaymentGateway {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? (() => Date.now());

  async function call(method: 'GET' | 'POST', path: string, body?: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const res = await doFetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${o.secretKey}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) {
      const err = (json?.error ?? {}) as { code?: string; message?: string };
      throw new PaymentGatewayError(err.code ?? `http_${res.status}`, err.message ?? `Stripe ${path} failed`);
    }
    return json;
  }

  return {
    async createPayment(input) {
      const data: Record<string, string | number | undefined> = {
        mode: 'payment',
        locale: 'th',
        client_reference_id: input.invoiceNo,
        'metadata[invoice_no]': input.invoiceNo,
        'payment_intent_data[metadata][invoice_no]': input.invoiceNo,
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': 'thb',
        'line_items[0][price_data][unit_amount]': input.amountSatang,
        'line_items[0][price_data][product_data][name]': input.description,
        success_url: `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(now() / 1000) + 60 * 60, // 1 hour (Stripe allows 30 min – 24 h)
      };
      if (o.paymentMethodConfiguration) data.payment_method_configuration = o.paymentMethodConfiguration;
      const s = await call('POST', '/checkout/sessions', form(data), `checkout-${input.invoiceNo}`);
      if (typeof s.url !== 'string' || typeof s.id !== 'string') throw new PaymentGatewayError('no_url', 'Stripe returned no checkout URL');
      return { url: s.url, gatewayRef: s.id };
    },

    async inquiry(gatewayRef) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(gatewayRef)) throw new PaymentGatewayError('bad_ref', 'not a checkout session id');
      const s = await call('GET', `/checkout/sessions/${gatewayRef}`);
      const pi = s.payment_intent;
      return {
        paid: s.payment_status === 'paid' && s.status === 'complete',
        amountSatang: typeof s.amount_total === 'number' ? s.amount_total : null,
        currency: typeof s.currency === 'string' ? s.currency : null,
        referenceNo: typeof pi === 'string' ? pi : null,
        channelCode: Array.isArray(s.payment_method_types) && s.payment_method_types.length === 1 ? String(s.payment_method_types[0]) : null,
      };
    },

    async parseNotification(rawBody, headers) {
      if (!o.webhookSecret) return null;
      if (!(await verifyStripeSignature(rawBody, headers.get('stripe-signature'), o.webhookSecret, now()))) return null;
      let event: { type?: string; data?: { object?: { object?: string; id?: string; client_reference_id?: string | null } } };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return null;
      }
      if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return null;
      const s = event.data?.object;
      if (s?.object !== 'checkout.session' || !s.id || !s.client_reference_id) return null;
      return { invoiceNo: s.client_reference_id, gatewayRef: s.id };
    },
  };
}
