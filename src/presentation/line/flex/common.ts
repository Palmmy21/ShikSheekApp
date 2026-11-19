/**
 * Welcome, onboarding, help, error and personality templates.
 */
import type { FlexMessage, Message, TextMessage } from '../../../infrastructure/line/messages.ts';
import { quickReply, text } from '../../../infrastructure/line/messages.ts';
import { mascotUrl, type MascotExpression } from '../mascot.ts';
import { pb } from './actions.ts';
import { BRAND, bubble, button, card, hbox, header, img, txt, vbox } from './theme.ts';

const flex = (altText: string, contents: FlexMessage['contents'], qr?: FlexMessage['quickReply']): FlexMessage => {
  const m: FlexMessage = { type: 'flex', altText: Array.from(altText).slice(0, 1500).join(''), contents };
  if (qr) m.quickReply = qr;
  return m;
};
export { flex };

const bullet = (emoji: string, title: string, desc: string) =>
  hbox([txt(emoji, { flex: 0, size: 'lg' }), vbox([txt(title, { weight: 'bold' }), txt(desc, { size: 'xs', color: BRAND.muted })], { flex: 1 })], {
    spacing: 'md',
  });

export function welcomeMessage(displayName: string | null): FlexMessage {
  const name = displayName ? `${displayName}` : 'เพื่อนใหม่';
  return flex(
    `ยินดีต้อนรับสู่ ShikSheek, ${name}!`,
    bubble({
      header: header('SHIKSHEEK', `หวัดดี ${name}!`, mascotUrl('encouraging'), { subtitle: 'ให้เรื่องเงินเป็นเรื่องชิกชิก!' }),
      body: [
        txt('ชิกชิกเป็นเพื่อนคู่ใจช่วยจดรายรับรายจ่าย เตือนบิล และบอกว่าเดือนนี้ใช้ได้อีกเท่าไหร่ 🐔'),
        card([
          bullet('✍️', 'จดง่ายแค่พิมพ์', '"กินข้าว 65" หรือ "ได้เงินเดือน 25000"'),
          bullet('📅', 'ไม่พลาดบิล', 'ค่าเช่า ค่าเน็ต เตือนก่อนครบกำหนด'),
          bullet('💰', 'รู้ยอดใช้ได้จริง', 'หักบิลที่ยังไม่จ่ายและเงินออมให้แล้ว'),
        ], { spacing: 'md' }),
      ],
      footer: [button(pb('เริ่มตั้งค่า 2 ขั้นตอน', 'onboard_start')), button(pb('ดูวิธีใช้', 'help'), 'link')],
    }),
  );
}

export function onboardingCycleMessage(): FlexMessage {
  return flex(
    'รอบเดือนของคุณเริ่มวันที่เท่าไหร่?',
    bubble({
      header: header('ตั้งค่า 1/2', 'รอบเดือนเริ่มวันไหน?', mascotUrl('planning')),
      body: [
        txt('ชิกชิกจะสรุปยอดตามรอบนี้ ถ้าเงินเดือนออกวันที่ 25 ก็เลือก 25 ได้เลย'),
        txt('เปลี่ยนทีหลังได้ในเมนูตั้งค่า', { size: 'xs', color: BRAND.muted }),
      ],
      footer: [
        button(pb('วันที่ 1 (ตามปฏิทิน)', 'onboard_cycle', { day: 1 }, { displayText: 'เริ่มวันที่ 1' })),
        hbox([
          button(pb('วันที่ 25', 'onboard_cycle', { day: 25 }, { displayText: 'เริ่มวันที่ 25' }), 'secondary', { flex: 1 }),
          button(pb('วันที่ 28', 'onboard_cycle', { day: 28 }, { displayText: 'เริ่มวันที่ 28' }), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
    }),
    quickReply(
      [5, 10, 15, 20, 26, 27].map((d) => pb(`วันที่ ${d}`, 'onboard_cycle', { day: d }, { displayText: `เริ่มวันที่ ${d}` })),
    ),
  );
}

export function onboardingIncomeMessage(): TextMessage {
  return text(
    'ตั้งค่า 2/2 💼\nเดือนนี้มีรายรับเท่าไหร่? พิมพ์มาได้เลย เช่น\n"ได้เงินเดือน 25000"\n\nแล้วชิกชิกจะคำนวณว่าใช้ได้อีกเท่าไหร่ให้ทันที',
    quickReply([pb('ข้ามไปก่อน', 'onboard_skip_income', {}, { displayText: 'ข้ามไปก่อน' })]),
  );
}

export function helpMessage(): FlexMessage {
  const example = (t: string) => vbox([txt(t, { size: 'sm', color: BRAND.deepRed, weight: 'bold' })], {
    backgroundColor: BRAND.softYellow, cornerRadius: '10px', paddingAll: '8px',
  });
  return flex(
    'วิธีใช้ ShikSheek',
    bubble({
      header: header('วิธีใช้', 'พิมพ์คุยกับชิกชิกได้เลย', mascotUrl('smart')),
      body: [
        txt('จดรายการ', { weight: 'bold' }),
        vbox([example('กินข้าว 65'), example('ซื้อกาแฟ 80 เมื่อวาน'), example('ได้เงินเดือน 25000')], { spacing: 'xs' }),
        txt('ถามได้เลย', { weight: 'bold', margin: 'md' }),
        vbox([example('วันนี้ใช้ไปเท่าไหร่'), example('เดือนนี้เหลือเงินเท่าไหร่'), example('พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง')], { spacing: 'xs' }),
        txt('ตั้งค่าใช้จ่ายประจำ: กดเมนู "ค่าใช้จ่ายประจำ" แล้วพิมพ์ เช่น "ค่าเน็ต 599 ทุกวันที่ 5"', { size: 'xs', color: BRAND.muted, margin: 'md' }),
      ],
      footer: [
        hbox([
          button(pb('ภาพรวม', 'dashboard'), 'primary', { flex: 1 }),
          button(pb('ตั้งค่า', 'settings'), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
    }),
  );
}

/** Mascot + speech bubble. Used for AI/rule-based personality replies and soft errors. */
export function mascotSays(message: string, expression: MascotExpression, actions: Parameters<typeof quickReply>[0] = []): FlexMessage {
  return flex(
    message,
    {
      type: 'bubble',
      size: 'kilo',
      body: hbox(
        [
          img(mascotUrl(expression), { size: '64px', flex: 0 }),
          vbox([txt(message, { size: 'sm' })], {
            backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center',
          }),
        ],
        { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md', alignItems: 'center' },
      ),
    },
    actions.length ? quickReply(actions) : undefined,
  );
}

export function errorMessage(message = 'อุ๊ย ชิกชิกสะดุดนิดหน่อย ลองใหม่อีกครั้งนะ 🙏'): Message {
  return mascotSays(message, 'worried', [pb('ภาพรวม', 'dashboard'), pb('วิธีใช้', 'help')]);
}

export function staleActionMessage(): Message {
  return mascotSays('ปุ่มนี้หมดอายุแล้วน้า ลองเริ่มใหม่อีกครั้ง', 'thinking', [pb('ภาพรวม', 'dashboard'), pb('วิธีใช้', 'help')]);
}
