/**
 * One-time data export download. Link is generated in LINE ("ส่งออกข้อมูล"), valid 15 minutes,
 * single use; only the token hash is stored.   (verify_jwt = false)
 *   GET /functions/v1/data-export?token=...            → JSON (everything)
 *   GET /functions/v1/data-export?token=...&format=csv → CSV (transactions)
 */
import { createPrivacyService, transactionsToCsv } from '../../../src/application/services/privacy-service.ts';
import { bootstrap } from '../_shared/bootstrap.ts';

const page = (msg: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#FFF8E9;color:#392B27;padding:32px;text-align:center"><h2>🐔 ShikSheek</h2><p>${msg}</p></body>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const { deps } = bootstrap();
  const privacy = createPrivacyService(deps.sql);
  const userId = await privacy.consumeExportToken(token);
  if (!userId) return page('ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้ในเมนูตั้งค่าของ ShikSheek', 410);

  const data = await privacy.buildExport(userId);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (format === 'csv') {
    return new Response(transactionsToCsv(data.transactions.map((t) => ({ ...t, userId }))), {
      headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="shiksheek-${stamp}.csv"` },
    });
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="shiksheek-${stamp}.json"` },
  });
});
