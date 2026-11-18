/**
 * Images (slips/receipts) and PDF files (receipts/statements).
 * Download → AI extraction (untrusted) → validation → confirmation card / import summary.
 * Documents are processed in memory and never stored.
 */
import { createImportService, MAX_DOCUMENT_BYTES, prepareImport, rowToDraft, summarizeRows } from '../../../application/services/import-service.ts';
import { formatThaiShort } from '../../../domain/dates.ts';
import { formatBaht } from '../../../domain/money.ts';
import type { DocMediaType } from '../../../infrastructure/ai/claude.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import { redactUserId, type HandlerContext } from '../context.ts';
import { pb } from '../flex/actions.ts';
import { mascotSays } from '../flex/common.ts';
import { importSummaryMessage } from '../flex/imports.ts';
import { proposeTransaction } from './views.ts';

function hasPdfMagic(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

function isEncryptedPdf(b: Uint8Array): boolean {
  // the /Encrypt dictionary appears in the trailer; scan the raw bytes as latin1
  const tail = b.subarray(Math.max(0, b.length - 4096));
  const head = b.subarray(0, Math.min(b.length, 4096));
  const text = (x: Uint8Array) => String.fromCharCode(...x);
  return text(tail).includes('/Encrypt') || text(head).includes('/Encrypt');
}

export async function handleDocumentMessage(ctx: HandlerContext, messageId: string, expected: 'image' | 'pdf'): Promise<Message[]> {
  const { deps, userId } = ctx;
  if (!deps.ai) {
    return [mascotSays('ตอนนี้ยังไม่ได้เปิดการอ่านสลิป/PDF น้า พิมพ์รายการแทนได้เลย เช่น "กินข้าว 65"', 'thinking')];
  }
  await deps.line.showLoading(userId, 30);

  const content = await deps.line.getContent(messageId, MAX_DOCUMENT_BYTES);
  if (!content) return [mascotSays('ไฟล์ใหญ่เกิน 10MB หรือดาวน์โหลดไม่ได้ ลองส่งใหม่อีกครั้งนะ', 'worried')];

  let mediaType: DocMediaType;
  if (expected === 'pdf') {
    if (!hasPdfMagic(content.bytes)) return [mascotSays('ไฟล์นี้ไม่ใช่ PDF น้า', 'thinking')];
    if (isEncryptedPdf(content.bytes)) {
      return [mascotSays('PDF นี้ติดรหัสผ่าน 🔒 ชิกชิกเปิดไม่ได้ ลองปลดล็อก (เช่น Print เป็น PDF ใหม่) แล้วส่งมาอีกครั้งนะ', 'worried')];
    }
    mediaType = 'application/pdf';
  } else {
    mediaType = content.contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  }

  const extraction = await deps.ai.extractDocument(content.bytes, mediaType);
  if (!extraction) {
    deps.log.warn('document_extract_failed', { user: redactUserId(userId), mediaType });
    return [mascotSays('อ่านเอกสารนี้ไม่สำเร็จ ลองถ่ายให้ชัดขึ้น หรือพิมพ์รายการเองได้เลยน้า', 'worried')];
  }
  if (extraction.kind === 'not_financial' || extraction.kind === 'unreadable' || extraction.rows.length === 0) {
    return [mascotSays(extraction.kind === 'unreadable' ? 'ภาพไม่ค่อยชัด ชิกชิกอ่านไม่ออก ลองใหม่อีกรูปนะ' : 'ไม่เจอรายการเงินในไฟล์นี้เลย ส่งสลิปโอนเงิน ใบเสร็จ หรือ statement มาได้น้า', 'thinking')];
  }

  const prepared = await prepareImport(extraction, ctx.today);
  if (prepared.rows.length === 0) {
    return [mascotSays('เจอเอกสารแต่อ่านยอดเงินหรือวันที่ไม่ได้ พิมพ์รายการเองแทนได้เลยน้า', 'thinking')];
  }

  // Single slip / receipt → normal confirmation card (same flow as chat)
  if (extraction.kind !== 'statement' && prepared.rows.length === 1) {
    const row = prepared.rows[0]!;
    if (row.externalRef) {
      const existing = await deps.repos.transactions.findByExternalRef(userId, row.externalRef);
      if (existing) {
        return [mascotSays(`สลิปนี้จดไปแล้วเมื่อ ${formatThaiShort(existing.txnDate, true)} (${formatBaht(existing.amountSatang)}) ไม่จดซ้ำให้นะ 😉`, 'smart', [pb('ดูประวัติ', 'txn_history', { p: 0 })])];
      }
    }
    return proposeTransaction(ctx, rowToDraft(row, expected === 'pdf' ? 'pdf' : 'slip'));
  }

  // Statement / multi-row → one summary card, imported atomically on confirm
  const imports = createImportService(deps.sql, deps.repos);
  const { draft, rows, alreadyRecorded } = await imports.createDraft(userId, prepared.rows);
  if (!draft) return [mascotSays(`ทุกรายการในไฟล์นี้จดไว้แล้ว (${alreadyRecorded} รายการ) ไม่มีอะไรใหม่ 👍`, 'smart')];
  return [importSummaryMessage(draft.id, summarizeRows(rows), rows, prepared.skipped, alreadyRecorded)];
}
