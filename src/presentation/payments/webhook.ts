/**
 * 2C2P backend notification endpoint. Runtime-agnostic: (Request) → Response.
 *
 * The body is only a hint: PaymentService verifies the JWT signature, then confirms the payment
 * with paymentInquiry (server-to-server) before granting. When a payment becomes paid for the
 * first time, the user gets a LINE message (push with a deterministic retry key).
 */
import { retryKeyFor } from '../../application/jobs.ts';
import { redactUserId, type AppDeps } from '../line/context.ts';
import { paidMessage } from '../line/flex/plans.ts';

const MAX_BODY = 64 * 1024;

export async function handlePaymentNotification(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!deps.payments) return new Response('payments not configured', { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('too large', { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  try {
    const r = await deps.payments.handleNotification(body);
    if (r.status === 'paid' && r.newlyPaid) {
      deps.log.info('payment_paid', { user: redactUserId(r.payment.userId), product: r.payment.product, amount: r.payment.amountSatang });
      await deps.line
        .push(r.payment.userId, [paidMessage(r.payment.plan, r.until)], await retryKeyFor('payment_paid', r.payment.invoiceNo))
        .catch((err) => deps.log.warn('payment_push_failed', { user: redactUserId(r.payment.userId), status: (err as { status?: number }).status ?? 0 }));
    } else if (r.status === 'not_found') {
      deps.log.warn('payment_notification_ignored', {});
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    // 5xx so 2C2P retries; the user can also tap "ตรวจสอบ"
    deps.log.error('payment_notification_failed', { error: err instanceof Error ? err.message : String(err) });
    return new Response('retry', { status: 500 });
  }
}
