import { createPrivacyService, EXPORT_TOKEN_TTL_MINUTES } from '../../../application/services/privacy-service.ts';
import type { Message } from '../../../infrastructure/line/messages.ts';
import type { HandlerContext } from '../context.ts';
import { flex } from '../flex/common.ts';
import { BRAND, bubble, button, header, txt } from '../flex/theme.ts';
import { mascotUrl } from '../mascot.ts';

let exportBaseUrl = '';
export function configureExportBaseUrl(url: string): void {
  exportBaseUrl = url.replace(/\/+$/, '');
}

export async function exportUserData(ctx: HandlerContext): Promise<Message[]> {
  if (!exportBaseUrl) return [{ type: 'text', text: 'ระบบส่งออกข้อมูลยังไม่ได้ตั้งค่า (DATA_EXPORT_URL)' }];
  const token = await createPrivacyService(ctx.deps.sql).createExportToken(ctx.userId);
  const json = `${exportBaseUrl}?token=${token}`;
  return [
    flex(
      'ลิงก์ส่งออกข้อมูลของคุณ',
      bubble({
        header: header('ส่งออกข้อมูล', 'ข้อมูลของคุณพร้อมแล้ว', mascotUrl('smart')),
        body: [
          txt(`ลิงก์ใช้ได้ครั้งเดียว ภายใน ${EXPORT_TOKEN_TTL_MINUTES} นาที อย่าส่งต่อให้คนอื่นนะ`),
          txt('JSON = ข้อมูลครบทุกอย่าง · CSV = รายการรับ-จ่าย เปิดใน Excel/Sheets ได้', { size: 'xs', color: BRAND.muted }),
        ],
        footer: [
          button({ type: 'uri', label: '⬇️ ดาวน์โหลด CSV', uri: `${json}&format=csv` }),
          button({ type: 'uri', label: 'ดาวน์โหลด JSON (ทั้งหมด)', uri: json }, 'link'),
        ],
      }),
    ),
  ];
}
