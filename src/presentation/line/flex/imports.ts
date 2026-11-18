/**
 * Statement import summary card. Figures are pre-summed by import-service.
 */
import { formatThaiShort } from '../../../domain/dates.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import { formatBaht } from '../../../domain/money.ts';
import type { ImportRow, ImportSummary } from '../../../application/services/import-service.ts';
import type { FlexMessage } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, row, sep, txt, vbox } from './theme.ts';

export function importSummaryMessage(draftId: string, s: ImportSummary, preview: ImportRow[], skipped: number, alreadyRecorded: number): FlexMessage {
  const lines = preview.slice(0, 6).map((r) =>
    hbox([
      vbox([txt(r.note ?? getCategory(r.categoryId).labelTh, { size: 'xs', weight: 'bold', wrap: false }), txt(formatThaiShort(r.txnDate), { size: 'xxs', color: BRAND.muted })], { flex: 6 }),
      txt(r.type === 'income' ? `+${formatBaht(r.amountSatang)}` : formatBaht(r.amountSatang), { size: 'xs', align: 'end', flex: 4, gravity: 'center', color: r.type === 'income' ? BRAND.green : BRAND.brown }),
    ]),
  );
  const notes: string[] = [];
  if (alreadyRecorded) notes.push(`ข้าม ${alreadyRecorded} รายการที่จดไว้แล้ว`);
  if (skipped) notes.push(`อ่านไม่ได้ ${skipped} รายการ`);
  return flex(
    `พบ ${s.count} รายการในเอกสาร — นำเข้าไหม?`,
    bubble({
      header: header('นำเข้าจากเอกสาร', `พบ ${s.count} รายการ`, mascotUrl('planning'), s.firstDate && s.lastDate ? { subtitle: `${formatThaiShort(s.firstDate, true)} – ${formatThaiShort(s.lastDate, true)}` } : {}),
      body: [
        card([
          row('รายจ่ายรวม', formatBaht(s.expenseSatang), { bold: true }),
          row('รายรับรวม', formatBaht(s.incomeSatang), { valueColor: BRAND.green }),
          sep({ margin: 'sm' }),
          ...lines,
          ...(s.count > lines.length ? [txt(`และอีก ${s.count - lines.length} รายการ`, { size: 'xxs', color: BRAND.muted, align: 'center' })] : []),
        ]),
        ...(notes.length ? [txt(notes.join(' · '), { size: 'xs', color: BRAND.muted })] : []),
        txt('ตรวจยอดรวมให้ตรงกับเอกสารก่อนกดนำเข้า หมวดหมู่แก้ทีหลังได้', { size: 'xs', color: BRAND.deepRed }),
      ],
      footer: [
        button(pb(`✅ นำเข้า ${s.count} รายการ`, 'import_confirm', { id: draftId }, { displayText: 'นำเข้าทั้งหมด' })),
        button(pb('ยกเลิก', 'draft_cancel', { id: draftId }, { displayText: 'ยกเลิก' }), 'link'),
      ],
    }),
  );
}
