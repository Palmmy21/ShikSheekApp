/**
 * Life plan in chat: the chicken as a travel companion toward each dream — progress, milestone road
 * ("ด่าน"), this month's amount, and a short coach note. Also links to the report and the
 * investing-basics room in LIFF.
 */
import type { DreamView } from '../../../application/services/dream-service.ts';
import { DREAM_MILESTONES } from '../../../domain/calculations/dreams.ts';
import { formatThaiShort } from '../../../domain/dates.ts';
import { formatBaht } from '../../../domain/money.ts';
import type { FlexBubble, FlexComponent, Message } from '../../../infrastructure/line/messages.ts';
import { liffLink } from '../links.ts';
import { mascotUrl, type MascotExpression } from '../mascot.ts';
import { flex, mascotSays } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, progressBar, row, txt, vbox } from './theme.ts';

const liffTab = (tab: string, extra = '') => {
  const l = liffLink();
  return l ? `${l}?tab=${tab}${extra}` : null;
};

function milestoneRoad(reached: number): FlexComponent {
  return hbox(
    DREAM_MILESTONES.map((m) =>
      vbox([txt(m <= reached ? '🚩' : '○', { size: 'sm', align: 'center', color: m <= reached ? BRAND.red : BRAND.muted }), txt(`${m}%`, { size: 'xxs', align: 'center', color: BRAND.muted })], { flex: 1 }),
    ),
    { margin: 'md' },
  );
}

function dreamBubble(d: DreamView): FlexBubble {
  const p = d.plan;
  const g = d.progress.goal;
  const saveUri = liffTab('plans', `&dream=${g.id}`);
  return bubble({
    header: header(`${d.template.emoji} อนาคตที่อยากมี`, g.name, mascotUrl(d.coach.mascot as MascotExpression)),
    body: [
      card([
        hbox([txt(formatBaht(p.savedSatang), { size: 'xl', weight: 'bold', flex: 0 }), txt(`/ ${formatBaht(p.targetSatang)}`, { size: 'sm', color: BRAND.muted, gravity: 'bottom', margin: 'sm' })]),
        progressBar(p.progressBasisPoints, BRAND.green),
        milestoneRoad(p.milestone),
      ], { spacing: 'sm' }),
      vbox([
        txt(d.coach.headline, { weight: 'bold', size: 'sm', wrap: true }),
        txt(d.coach.body, { size: 'sm', wrap: true, color: BRAND.brown }),
      ], { spacing: 'xs' }),
      ...(p.status !== 'reached'
        ? [card([
            row('เดือนนี้ควรเก็บ', formatBaht(p.monthlyNeededSatang), { bold: true, valueColor: BRAND.red }),
            row('อีก', `${p.monthsLeft} เดือน · ถึง ${formatThaiShort(g.targetDate!, true)}`),
          ])]
        : []),
    ],
    footer: saveUri && p.status !== 'reached' ? [button({ type: 'uri', label: '🐷 เก็บเข้าความฝันนี้', uri: saveUri }, 'primary')] : [],
  });
}

/** One carousel of dream bubbles (≤ 5), or null when the user has none. */
export function dreamsCoachMessage(dreams: readonly DreamView[]): Message | null {
  const active = dreams.slice(0, 5);
  if (!active.length) return null;
  const first = active[0]!;
  const alt = `ชิกชิกโค้ชประจำเดือน: ${first.progress.goal.name} ${Math.floor(first.plan.progressBasisPoints / 100)}%`;
  return active.length === 1 ? flex(alt, dreamBubble(first)) : flex(alt, { type: 'carousel', contents: active.map(dreamBubble) });
}

/** "แผนชีวิต": the dreams, or an invitation to set the first one. */
export function dreamsMessage(dreams: readonly DreamView[]): Message {
  const coach = dreamsCoachMessage(dreams);
  if (coach) return coach;
  const uri = liffTab('plans', '&dream=new');
  if (!uri) return mascotSays('ตั้งความฝันได้ในแอปชิกชิก (LIFF) ซึ่งยังไม่ได้ตั้งค่าน้า', 'thinking');
  return flex('อยากมีอนาคตแบบไหน? ตั้งความฝันแรกกับชิกชิกกัน', bubble({
    header: header('อนาคตที่อยากมี', 'ตั้งความฝันแรกกัน ✨', mascotUrl('planning')),
    body: [
      txt('บ้านหลังแรก เที่ยวรอบโลก เปิดร้าน หรือเกษียณสบาย บอกชิกชิกว่าอยากไปถึงไหน แล้วชิกชิกจะคำนวณว่าต้องเก็บเดือนละเท่าไหร่ แบ่งเป็นด่าน และเดินไปด้วยกันทุกเดือน', { size: 'sm', wrap: true }),
    ],
    footer: [button({ type: 'uri', label: '✨ ตั้งความฝัน', uri }, 'primary')],
  }));
}

export function reportLinkMessage(): Message {
  const uri = liffTab('report');
  if (!uri) return mascotSays('รายงานเปิดได้ในแอปชิกชิก (LIFF) ซึ่งยังไม่ได้ตั้งค่าน้า', 'thinking');
  return flex('ส่งออกรายงานรายรับรายจ่าย (PDF / Excel)', bubble({
    header: header('รายงานรายรับรายจ่าย', 'บันทึกเป็น PDF หรือ Excel', mascotUrl('smart')),
    body: [txt('เลือกช่วงเดือนหรือทั้งปี ได้สรุปรายรับ รายจ่าย ตามเดือนและหมวด พร้อมรายการทั้งหมด เอาไปยื่นกู้ ทำบัญชี หรือเก็บไว้ดูเองก็ได้', { size: 'sm', wrap: true })],
    footer: [button({ type: 'uri', label: '📄 เปิดรายงาน', uri }, 'primary')],
  }));
}

export function learnLinkMessage(): Message {
  const uri = liffTab('learn');
  if (!uri) return mascotSays('ห้องเรียนลงทุนเปิดได้ในแอปชิกชิก (LIFF) ซึ่งยังไม่ได้ตั้งค่าน้า', 'thinking');
  return flex('ห้องเรียนลงทุนกับชิกชิก', bubble({
    header: header('ห้องเรียนลงทุน 📚', 'พื้นฐานก่อนเริ่มลงทุน', mascotUrl('smart')),
    body: [
      txt('ดอกเบี้ยทบต้น, DCA, กระจายความเสี่ยง, ความเสี่ยงกับผลตอบแทน และวิธีดูกลโกง พร้อมเครื่องคิดเลขให้ลองเล่น', { size: 'sm', wrap: true }),
      txt('เป็นความรู้ทั่วไป ไม่ใช่คำแนะนำให้ซื้อขายหลักทรัพย์ใดๆ', { size: 'xs', color: BRAND.muted, wrap: true }),
    ],
    footer: [button({ type: 'uri', label: '📚 เข้าห้องเรียน', uri }, 'primary')],
  }));
}
