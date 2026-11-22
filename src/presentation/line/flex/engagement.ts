/**
 * Engagement templates: invite friends (referral), streak celebrations, reward notices and the
 * gentle daily/win-back nudges.
 */
import { STREAK_REWARD_AT, STREAK_REWARD_DAYS } from '../../../domain/calculations/streak.ts';
import { REFERRAL_ACTIVATION_ENTRIES, REFERRAL_MAX_REWARDS, REFERRAL_REWARD_DAYS } from '../../../domain/plans.ts';
import type { FlexComponent, FlexMessage, Message } from '../../../infrastructure/line/messages.ts';
import { liffLink } from '../links.ts';
import { mascotUrl, type MascotExpression } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex, mascotSays } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, progressBar, txt, vbox } from './theme.ts';

const ADD_FRIEND = 'https://line.me/R/ti/p/%40541ywsff';
const thaiDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

export function inviteLink(code: string): string {
  const liff = liffLink();
  return liff ? `${liff}?ref=${code}` : ADD_FRIEND;
}

export function shareText(code: string): string {
  return `มาจดเงินกับชิกชิก 🐔 ผู้ช่วยการเงินบน LINE กัน! พิมพ์ "กินข้าว 65" ก็จดได้ ส่งสลิปก็อ่านให้ แถมช่วยให้มีเงินเหลือเก็บ\nเข้าผ่านลิงก์นี้ จดครบ ${REFERRAL_ACTIVATION_ENTRIES} รายการ รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วันทั้งคู่ 🎁\n${inviteLink(code)}\n(หรือเพิ่มเพื่อน @541ywsff แล้วพิมพ์ "โค้ด ${code}")`;
}

export function inviteMessage(info: { code: string; invited: number; rewarded: number; remaining: number }): FlexMessage {
  const share = `https://line.me/R/share?text=${encodeURIComponent(shareText(info.code))}`;
  return flex(`ชวนเพื่อน รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วัน · โค้ด ${info.code}`, bubble({
    header: header('ชวนเพื่อน', `รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วันทั้งคู่ 🎁`, mascotUrl('excited')),
    body: [
      card([
        txt('โค้ดของคุณ', { size: 'xs', color: BRAND.muted, align: 'center' }),
        txt(info.code, { size: 'xxl', weight: 'bold', align: 'center', color: BRAND.red }),
      ], { spacing: 'xs' }),
      vbox([
        txt(`1. แชร์ลิงก์ให้เพื่อน`, { size: 'sm', wrap: true }),
        txt(`2. เพื่อนเข้าผ่านลิงก์ (หรือพิมพ์ "โค้ด ${info.code}") แล้วจดครบ ${REFERRAL_ACTIVATION_ENTRIES} รายการ`, { size: 'sm', wrap: true }),
        txt(`3. ได้ Plus ฟรี ${REFERRAL_REWARD_DAYS} วันทั้งคุณและเพื่อน`, { size: 'sm', wrap: true }),
      ], { spacing: 'xs' }),
      card([
        hbox([txt('ชวนสำเร็จ', { size: 'sm', flex: 6 }), txt(`${info.rewarded} / ${REFERRAL_MAX_REWARDS} คน`, { size: 'sm', weight: 'bold', align: 'end', flex: 4 })]),
        progressBar(Math.min(10_000, Math.round((info.rewarded / REFERRAL_MAX_REWARDS) * 10_000)), BRAND.green),
        txt(info.invited > info.rewarded ? `รอเพื่อนจดให้ครบอีก ${info.invited - info.rewarded} คน` : `ได้รับไปแล้ว ${info.rewarded * REFERRAL_REWARD_DAYS} วัน`, { size: 'xs', color: BRAND.muted, wrap: true }),
      ], { spacing: 'sm' }),
    ],
    footer: [
      button({ type: 'uri', label: 'แชร์ให้เพื่อนใน LINE', uri: share }, 'primary'),
      button(pb('แพ็กเกจของฉัน', 'plans'), 'link'),
    ],
  }));
}

export function claimReply(status: 'ok' | 'invalid' | 'self' | 'already' | 'not_new', referrerName: string | null): Message {
  switch (status) {
    case 'ok':
      return mascotSays(`รับคำชวน${referrerName ? `จาก ${referrerName}` : ''}แล้ว 🎉 จดให้ครบ ${REFERRAL_ACTIVATION_ENTRIES} รายการ รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วันทั้งคู่! เริ่มเลย เช่น "กาแฟ 60"`, 'celebrating', [pb('จดรายจ่าย', 'add_expense'), pb('📷 สแกนสลิป', 'scan')]);
    case 'self':
      return mascotSays('อันนี้โค้ดของคุณเองน้า ส่งให้เพื่อนแทนนะ 😆', 'smart', [pb('ชวนเพื่อน', 'invite')]);
    case 'already':
      return mascotSays('บัญชีนี้ใช้โค้ดชวนไปแล้วน้า (ใช้ได้ครั้งเดียว)', 'thinking');
    case 'not_new':
      return mascotSays('โค้ดชวนใช้ได้เฉพาะ 7 วันแรกหลังเริ่มใช้ชิกชิก แต่คุณชวนเพื่อนต่อรับ Plus ฟรีได้นะ!', 'thinking', [pb('ชวนเพื่อน', 'invite')]);
    default:
      return mascotSays('ไม่เจอโค้ดนี้เลย ลองเช็กอีกครั้งน้า (6 ตัว เช่น "โค้ด AB3XYZ")', 'thinking');
  }
}

const MILESTONE_LINE: Record<number, [string, MascotExpression]> = {
  3: ['จดต่อเนื่อง 3 วันแล้ว! เริ่มเป็นนิสัยแล้วนะ 🔥', 'happy'],
  7: ['ครบ 7 วันติด! สัปดาห์แรกผ่านไปแบบเท่ๆ 🔥🔥', 'excited'],
  14: ['14 วันติด! ชิกชิกภูมิใจมาก 🏅', 'proud'],
  30: [`30 วันติด!! สุดยอด 🏆 รับ Plus ฟรี ${STREAK_REWARD_DAYS} วันเป็นรางวัล`, 'celebrating'],
  60: ['60 วันติด! วินัยระดับเทพ 💎', 'proud'],
  100: ['100 วันติด!!! ตำนานชิกชิก 👑', 'celebrating'],
  365: ['ครบ 1 ปีเต็ม!!! ขอบคุณที่อยู่ด้วยกันมาตลอด 🎂', 'celebrating'],
};

export function streakMilestoneMessage(days: number, rewardUntil: string | null): Message {
  const [line, mood] = MILESTONE_LINE[days] ?? [`จดต่อเนื่อง ${days} วัน 🔥`, 'happy' as MascotExpression];
  const extra = days === STREAK_REWARD_AT && rewardUntil ? ` (ใช้ได้ถึง ${thaiDate(rewardUntil)})` : '';
  return mascotSays(`${line}${extra}`, mood, [pb('🎁 ชวนเพื่อนมาจดด้วย', 'invite'), pb('แผนการเงิน', 'wealth_plan')]);
}

export function referralRewardMessage(who: 'referee' | 'referrer', until: string | null): Message {
  const end = until ? ` ใช้ได้ถึง ${thaiDate(until)}` : '';
  return who === 'referee'
    ? mascotSays(`ครบ ${REFERRAL_ACTIVATION_ENTRIES} รายการแล้ว! 🎁 คุณกับเพื่อนได้ Plus ฟรี ${REFERRAL_REWARD_DAYS} วัน${end}`, 'celebrating', [pb('แพ็กเกจของฉัน', 'plans'), pb('ชวนต่อ', 'invite')])
    : mascotSays(`เพื่อนที่คุณชวนเริ่มจดแล้ว! 🎁 รับ Plus ฟรี ${REFERRAL_REWARD_DAYS} วัน${end} ชวนต่อได้อีกนะ`, 'celebrating', [pb('ชวนเพื่อนเพิ่ม', 'invite'), pb('แพ็กเกจของฉัน', 'plans')]);
}

/** 20:00 — only when a streak would break tonight. */
export function streakReminderMessage(days: number): Message {
  return mascotSays(`🔥 สตรีค ${days} วันจะหลุดคืนนี้น้า! จดสักรายการก่อนนอน เช่น "ข้าวเย็น 60" หรือส่งสลิปก็ได้`, 'worried', [
    { type: 'camera', label: '📷 ถ่ายสลิป/ใบเสร็จ' },
    pb('จดรายจ่าย', 'add_expense'),
    pb('ปิดการเตือนนี้', 'settings_toggle', { k: 'streakReminders' }),
  ]);
}

/** Once after 3 quiet days. */
export function winbackMessage(): Message {
  return mascotSays('หายไปหลายวันเลย ชิกชิกคิดถึงน้า 🥺 กลับมาจดต่อกัน ส่งสลิปที่ค้างไว้มาทีเดียวก็ได้ ชิกชิกอ่านให้หมด', 'sleepy', [
    { type: 'cameraRoll', label: '🖼️ ส่งสลิปที่ค้าง' },
    pb('ภาพรวม', 'dashboard'),
    pb('ปิดการเตือนนี้', 'settings_toggle', { k: 'streakReminders' }),
  ]);
}

/** Small streak line for the "saved" card. */
export function streakLine(days: number): FlexComponent | null {
  if (days < 2) return null;
  return txt(`🔥 จดต่อเนื่อง ${days} วัน`, { size: 'sm', weight: 'bold', color: BRAND.deepRed });
}

/** LIFF deep link to the story-card studio, or null when LIFF is not configured. */
export function storyLink(): string | null {
  const liff = liffLink();
  return liff ? `${liff}?tab=story` : null;
}

export function storyMessage(): Message {
  const uri = storyLink();
  if (!uri) return mascotSays('การ์ดสตอรี่ต้องเปิดผ่านแอปชิกชิก (LIFF) ซึ่งยังไม่ได้ตั้งค่าน้า', 'thinking');
  return flex('การ์ดสรุปเดือนของคุณพร้อมแชร์ลงสตอรี่แล้ว ✨', bubble({
    header: header('การ์ดสตอรี่ของคุณ', 'สรุปเดือนนี้ พร้อมลง IG ✨', mascotUrl('celebrating')),
    body: [
      txt('ชิกชิกสรุปเดือนของคุณเป็นการ์ดสวยๆ ขนาดสตอรี่ ดูว่าเดือนนี้คุณเป็น "ไก่แบบไหน" แล้วแชร์ให้เพื่อนอิจฉาเล่น 😎', { size: 'sm', wrap: true }),
      txt('ซ่อนยอดเงินได้ก่อนแชร์ · รายรับไม่ขึ้นบนการ์ดเลย', { size: 'xs', color: BRAND.muted, wrap: true }),
    ],
    footer: [button({ type: 'uri', label: '✨ เปิดการ์ดของฉัน', uri }, 'primary')],
  }));
}
