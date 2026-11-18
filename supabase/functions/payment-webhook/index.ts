/**
 * Stripe webhook (checkout.session.completed / async_payment_succeeded).
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-webhook   (verify_jwt = false)
 * Authenticity: Stripe-Signature (STRIPE_WEBHOOK_SECRET) + server-side session re-fetch.
 */
import { handlePaymentNotification } from '../../../src/presentation/payments/webhook.ts';
import { bootstrap } from '../_shared/bootstrap.ts';

Deno.serve(async (req: Request) => {
  let app;
  try {
    app = bootstrap();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'bootstrap_failed', error: err instanceof Error ? err.message : String(err) }));
    return new Response('misconfigured', { status: 500 });
  }
  return handlePaymentNotification(req, app.deps);
});
