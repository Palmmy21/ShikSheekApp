/**
 * JSON API for the LIFF web app.
 * URL: https://<project-ref>.supabase.co/functions/v1/api/<route>   (verify_jwt = false)
 * Auth: LIFF ID token (Bearer), verified with LINE against LINE_LOGIN_CHANNEL_ID.
 */
import { createIdTokenVerifier, type IdTokenVerifier } from '../../../src/infrastructure/line/id-token.ts';
import { handleApiRequest } from '../../../src/presentation/api/router.ts';
import { bootstrap } from '../_shared/bootstrap.ts';

let verifier: IdTokenVerifier | null = null;

Deno.serve(async (req: Request) => {
  let app;
  try {
    app = bootstrap();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'bootstrap_failed', error: err instanceof Error ? err.message : String(err) }));
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  const { config, deps } = app;
  if (!config.LINE_LOGIN_CHANNEL_ID) {
    return new Response(JSON.stringify({ error: 'LINE_LOGIN_CHANNEL_ID not configured' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  verifier ??= createIdTokenVerifier(config.LINE_LOGIN_CHANNEL_ID);
  const allowedOrigins = config.API_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  return handleApiRequest(req, deps, { verify: verifier, allowedOrigins });
});
