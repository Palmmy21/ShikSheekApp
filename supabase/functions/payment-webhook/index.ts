/**
 * 2C2P backend notification (backendReturnUrl).
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-webhook   (verify_jwt = false)
 * Authenticity: HS256 JWT signed with the 2C2P merchant secret + paymentInquiry confirmation.
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
