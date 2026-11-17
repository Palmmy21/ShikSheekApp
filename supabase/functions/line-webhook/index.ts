/**
 * LINE webhook endpoint.
 * URL: https://<project-ref>.supabase.co/functions/v1/line-webhook   (verify_jwt = false)
 *
 * Responds 200 immediately after signature verification and processes events in the background,
 * so LINE never times out; reply tokens are used well within their validity window.
 */
import { handleWebhookRequest } from '../../../src/application/webhook.ts';
import { bootstrap, runInBackground } from '../_shared/bootstrap.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ShikSheek 🐔', { status: 200 });
  let app;
  try {
    app = bootstrap();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'bootstrap_failed', error: err instanceof Error ? err.message : String(err) }));
    return new Response('misconfigured', { status: 500 });
  }
  const raw = await req.text(); // RAW body — signature is computed over these exact bytes
  const result = await handleWebhookRequest(raw, req.headers.get('x-line-signature'), app.config.LINE_CHANNEL_SECRET, app.deps);
  const pending = runInBackground(
    result.work.catch((err) => app.deps.log.error('webhook_work_failed', { error: err instanceof Error ? err.message : String(err) })),
  );
  if (pending) await pending;
  return new Response(result.body, { status: result.status });
});
