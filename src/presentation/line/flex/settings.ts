/**
 * Settings, privacy (export/delete) templates.
 */
import type { NotificationPrefs, UserProfile } from '../../../domain/entities/index.ts';
import type { FlexMessage, Message } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { liffLink } from '../links.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, pill, txt, vbox } from './theme.ts';

const PREF_LABEL: Record<keyof NotificationPrefs, string> = {
  dailySummary: 'สรุปรายวัน (21:00)',
  weeklySummary: 'สรุปรายสัปดาห์ (อา. 20:00)',
  monthlySummary: 'สรุปสิ้นรอบเดือน',
  billReminders: 'เตือนบิล (08:00)',
  budgetAlerts: 'เตือนเมื่อใกล้เกินงบ',
  streakReminders: 'เตือนสตรีค 🔥 (20:00)',
};

export function settingsMessage(u: UserProfile): FlexMessage {
  const toggles = (Object.keys(PREF_LABEL) as Array<keyof NotificationPrefs>).map((k) =>
    hbox(
      [
        txt(PREF_LABEL[k], { size: 'sm', flex: 7 }),
        vbox([u.notifications[k] ? pill('เปิด', '#DDF3E7', BRAND.green) : pill('ปิด', BRAND.track, BRAND.muted)], { flex: 2, alignItems: 'flex-end' }),
      ],
      { action: pb(PREF_LABEL[k], 'settings_toggle', { k }), alignItems: 'center', paddingTop: '4px', paddingBottom: '4px' },
    ),
  );
  return flex(
    'ตั้งค่า',
    bubble({
      header: header('ตั้งค่า', 'ปรับให้เข้ากับคุณ', mascotUrl('smart')),
      body: [
        card([txt('การแจ้งเตือน (แตะเพื่อเปิด/ปิด)', { weight: 'bold', size: 'sm' }), ...toggles], { spacing: 'xs' }),
        card([
          hbox([txt('รอบเดือนเริ่มวันที่', { size: 'sm', flex: 7 }), txt(String(u.cycleStartDay), { size: 'sm', weight: 'bold', align: 'end', flex: 2 })], {
            action: pb('รอบเดือน', 'settings_cycle'),
          }),
        ]),
      ],
      footer: [
        hbox([button(pb('📦 ส่งออกข้อมูล', 'data_export'), 'secondary', { flex: 1 }), button(pb('🗑️ ลบข้อมูล', 'data_delete'), 'secondary', { flex: 1 })], { spacing: 'sm' }),
        button(pb('⭐ แพ็กเกจของฉัน', 'plans'), 'link'),
        button(pb('🎁 ชวนเพื่อน รับ Plus ฟรี', 'invite'), 'link'),
        ...(liffLink() ? [button({ type: 'uri', label: '📱 ตั้งค่าในแอป', uri: liffLink()! }, 'link')] : []),
      ],
    }),
  );
}

export function cycleSettingMessage(current: number): Message {
  return text(
    `ตอนนี้รอบเดือนเริ่มวันที่ ${current}\nเลือกใหม่ได้เลย (1-28)`,
    quickReply([1, 5, 10, 15, 20, 25, 26, 27, 28].map((d) => pb(`วันที่ ${d}`, 'onboard_cycle', { day: d }, { displayText: `รอบเดือนเริ่มวันที่ ${d}` }))),
  );
}

export function deleteDataConfirmMessage(): Message {
  return text(
    '⚠️ ลบข้อมูลทั้งหมด\nรายการ บิล งบ และเป้าหมายทั้งหมดจะถูกลบถาวร กู้คืนไม่ได้\n\nแนะนำให้ "ส่งออกข้อมูล" เก็บไว้ก่อนนะ',
    quickReply([
      pb('ลบถาวร', 'data_delete_confirm', {}, { displayText: 'ยืนยันลบข้อมูลทั้งหมด' }),
      pb('📦 ส่งออกก่อน', 'data_export'),
      pb('ไม่ลบ', 'cancel_flow', {}, { displayText: 'ไม่ลบ' }),
    ]),
  );
}
