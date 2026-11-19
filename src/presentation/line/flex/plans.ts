/**
 * Plan templates: "แพ็กเกจของฉัน" (status + usage + Plus/Pro cards) and the soft upgrade card shown
 * when a limit is reached. No payment yet: "สนใจ" records interest for the launch.
 */
import type { PlanLimitError, PlanStatus, PlanUsage } from '../../../application/services/entitlement-service.ts';
import { PLAN_PITCH, PLANS, PRICES, PRODUCTS, upgradeTarget, type PaidPlan, type ProductId } from '../../../domain/plans.ts';
import type { FlexBubble, FlexComponent, FlexMessage } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, pill, progressBar, txt, vbox } from './theme.ts';

const PLAN_COLOR: Record<PaidPlan, string> = { plus: BRAND.red, pro: '#6B4FD8' };

function priceLine(p: PaidPlan): string {
  return `฿${PRICES[p].monthly}/เดือน · ฿${PRICES[p].yearly.toLocaleString('en-US')}/ปี`;
}

/** How the plan cards can be acted on right now. */
export interface CheckoutOptions {
  /** PromptPay checkout configured (Stripe) */
  payable: boolean;
  /** early-bird Plus price still available to this user */
  earlyBird: boolean;
}

function buyButtons(p: PaidPlan, o: CheckoutOptions): FlexComponent[] {
  if (!o.payable) return [button(pb(`สนใจ ${PLANS[p].label}`, 'plan_interest', { p }), 'primary', { color: PLAN_COLOR[p] })];
  const yearly: ProductId = p === 'plus' ? (o.earlyBird ? 'plus_early' : 'plus_yearly') : 'pro_yearly';
  const monthly: ProductId = p === 'plus' ? 'plus_monthly' : 'pro_monthly';
  return [
    button(pb(`รายปี ฿${PRODUCTS[yearly].baht.toLocaleString('en-US')}`, 'pay_start', { p: yearly }), 'primary', { color: PLAN_COLOR[p], height: 'sm' }),
    button(pb(`รายเดือน ฿${PRODUCTS[monthly].baht}`, 'pay_start', { p: monthly }), 'secondary', { height: 'sm' }),
  ];
}

function planCard(p: PaidPlan, current: boolean, o: CheckoutOptions): FlexBubble {
  return bubble({
    size: 'kilo',
    header: header(`ชิกชิก ${PLANS[p].label}`, `฿${PRICES[p].monthly}/เดือน`, mascotUrl(p === 'pro' ? 'proud' : 'celebrating'), { bg: p === 'pro' ? '#5B3FC4' : undefined, subtitle: `หรือ ฿${PRICES[p].yearly.toLocaleString('en-US')}/ปี` }),
    body: [
      vbox(PLAN_PITCH[p].map((line) => hbox([txt('✓', { flex: 0, color: PLAN_COLOR[p], weight: 'bold', size: 'sm' }), txt(line, { size: 'sm', wrap: true, flex: 1 })], { spacing: 'sm' })), { spacing: 'sm' }),
      ...(p === 'plus' && o.earlyBird ? [txt(`🐣 ผู้ใช้กลุ่มแรก: ฿${PRICES.plus.earlyBirdYearly}/ปี (ปกติ ฿${PRICES.plus.yearly})`, { size: 'xs', color: BRAND.muted, wrap: true })] : []),
      ...(o.payable ? [txt('จ่ายด้วย PromptPay · ไม่ต่ออายุอัตโนมัติ', { size: 'xxs', color: BRAND.muted, wrap: true })] : []),
    ],
    footer: [...(current ? [txt('✓ แพ็กเกจปัจจุบัน ซื้อเพิ่มเพื่อต่ออายุ', { size: 'xs', color: BRAND.green, align: 'center', wrap: true })] : []), ...buyButtons(p, o)],
  });
}

/** After tapping a buy button: open the Stripe PromptPay page, then confirm. */
export function checkoutMessage(paymentId: string, product: ProductId, url: string): FlexMessage {
  const p = PRODUCTS[product];
  return flex(`ชำระ ${p.label} ฿${p.baht}`, {
    type: 'bubble',
    size: 'kilo',
    header: header('ชำระเงิน', `฿${p.baht.toLocaleString('en-US')}`, mascotUrl('excited'), { subtitle: p.label }),
    body: vbox([
      txt('1. แตะ "เปิดหน้าชำระเงิน" จะเห็น QR PromptPay', { size: 'sm', wrap: true }),
      txt('2. สแกนจ่ายด้วยแอปธนาคาร (หรือบันทึกรูป QR แล้วเปิดในแอป)', { size: 'sm', wrap: true }),
      txt('3. จ่ายเสร็จ ชิกชิกจะแจ้งในแชทอัตโนมัติ', { size: 'sm', wrap: true }),
      txt(`ใช้ได้ ${p.days} วัน · ไม่ต่ออายุอัตโนมัติ · ลิงก์หมดอายุใน 1 ชั่วโมง`, { size: 'xs', color: BRAND.muted, wrap: true }),
    ], { spacing: 'sm' }),
    footer: vbox([
      button({ type: 'uri', label: 'เปิดหน้าชำระเงิน', uri: url }, 'primary', { color: PLAN_COLOR[p.plan] }),
      button(pb('จ่ายแล้ว ตรวจสอบ', 'pay_check', { id: paymentId }), 'secondary', { height: 'sm' }),
    ], { spacing: 'sm' }),
  });
}

export function paidMessage(plan: PaidPlan, until: string | null, info: { event?: 'converted' | 'renewed' | 'upgraded' | 'downgraded'; feeSatang?: number } = {}): FlexMessage {
  const date = until ? new Date(until).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }) : null;
  const welcome = info.event === 'converted' ? `ยินดีต้อนรับสู่ครอบครัวชิกชิก ${PLANS[plan].label}! 🎉` : info.event === 'upgraded' ? `อัปเกรดเป็นชิกชิก ${PLANS[plan].label} แล้ว! 🎉` : `ได้รับเงินแล้ว ขอบคุณมากน้า! 🎉 ชิกชิก ${PLANS[plan].label}`;
  const fee = info.feeSatang ? ` จดค่าสมาชิก ฿${(info.feeSatang / 100).toLocaleString('en-US')} เป็นรายจ่ายหมวดบิลให้แล้ว` : '';
  const msg = `${welcome}${date ? ` ใช้ได้ถึง ${date}` : ''}${fee}`;
  return flex(msg, {
    type: 'bubble',
    size: 'kilo',
    body: vbox([
      hbox([
        { type: 'image', url: mascotUrl('celebrating'), size: '72px', flex: 0 } as FlexComponent,
        vbox([txt(msg, { size: 'sm', wrap: true })], { backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center' }),
      ], { spacing: 'md', alignItems: 'center' }),
      vbox([button(pb('ดูภาพรวม', 'dashboard'), 'primary', { height: 'sm' }), button(pb('แพ็กเกจของฉัน', 'plans'), 'secondary', { height: 'sm' })], { spacing: 'sm' }),
    ], { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' }),
  });
}

function meter(label: string, used: number, limit: number | null): FlexComponent {
  const value = limit === null ? `${used} · ไม่จำกัด` : `${used} / ${limit}`;
  const items: FlexComponent[] = [hbox([txt(label, { size: 'sm', flex: 6 }), txt(value, { size: 'sm', weight: 'bold', align: 'end', flex: 4 })])];
  if (limit !== null) {
    const bp = Math.min(10_000, Math.round((used / limit) * 10_000));
    items.push(progressBar(bp, bp >= 10_000 ? BRAND.red : bp >= 8_000 ? '#E7A21B' : BRAND.green));
  }
  return vbox(items, { spacing: 'xs' });
}

export function planStatusMessage(s: PlanStatus, u: PlanUsage, o: CheckoutOptions = { payable: false, earlyBird: true }): FlexMessage {
  const badge =
    s.source === 'trial'
      ? pill(`ทดลอง Pro ฟรี · เหลือ ${s.daysLeft} วัน`, '#EEE9FF', '#6B4FD8')
      : s.plan === 'free'
        ? pill('แพ็กเกจฟรี', BRAND.track, BRAND.muted)
        : pill(`${s.limits.label} · ถึง ${new Date(s.until!).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })}`, '#DDF3E7', BRAND.green);
  const status = bubble({
    size: 'kilo',
    header: header('แพ็กเกจของฉัน', s.limits.label, mascotUrl('smart')),
    body: [
      hbox([badge], { justifyContent: 'flex-start' }),
      card([
        txt('การใช้งานเดือนนี้', { weight: 'bold', size: 'sm' }),
        meter('อ่านสลิป/PDF', u.docs, s.limits.docsPerMonth),
        meter('AI ช่วยเข้าใจ', u.ai, s.limits.aiPerMonth),
        meter('บิลประจำ', u.fixedCosts, s.limits.fixedCosts),
        meter('เป้าออม', u.goals, s.limits.goals),
      ], { spacing: 'md' }),
      txt(
        s.limits.scheduledPush ? '🔔 สรุปรายวันและเตือนบิล: เปิดใช้ได้' : '🔕 แพ็กเกจฟรีได้สรุปสิ้นเดือน · กด "สรุปวันนี้" ดูเองได้ทุกเมื่อ',
        { size: 'xs', color: BRAND.muted, wrap: true },
      ),
      txt('จดผ่านแชท ถามยอด ส่งออก/ลบข้อมูล ฟรีไม่จำกัดเสมอ', { size: 'xs', color: BRAND.muted, wrap: true }),
    ],
    footer: [button(pb('ชวนเพื่อน รับ Plus ฟรี', 'invite'), 'secondary', { height: 'sm' })],
  });
  const paidNow = s.source === 'paid' ? s.plan : null;
  return flex(`แพ็กเกจ ${s.limits.label}`, { type: 'carousel', contents: [status, planCard('plus', paidNow === 'plus', o), planCard('pro', paidNow === 'pro', o)] });
}

const REASON: Record<PlanLimitError['feature'], (limit: number | null, plan: string) => string> = {
  fixed_costs: (n, plan) => `แพ็กเกจ${plan}ตั้งบิลประจำได้ ${n} รายการ ครบแล้วน้า`,
  goals: (n, plan) => `แพ็กเกจ${plan}ตั้งเป้าออมได้ ${n} เป้า ครบแล้วน้า`,
  category_budget: () => 'แพ็กเกจฟรีตั้งได้เฉพาะ "งบรวมทั้งเดือน" งบรายหมวดเป็นของ Plus น้า',
  docs: (n) => `เดือนนี้อ่านสลิป/PDF ครบ ${n} ครั้งแล้ว (เริ่มนับใหม่วันที่ 1) ระหว่างนี้พิมพ์รายการเองได้เลย`,
  history: (n) => `แพ็กเกจฟรีดูรายงานย้อนหลังได้ ${n} เดือน`,
};

export function planLimitMessage(err: PlanLimitError, payable = false): FlexMessage {
  const target = upgradeTarget(err.plan);
  const reason = REASON[err.feature](err.limit, PLANS[err.plan].label === 'ฟรี' ? 'ฟรี' : ` ${PLANS[err.plan].label} `);
  return flex(reason, {
    type: 'bubble',
    size: 'kilo',
    body: vbox([
      hbox([
        { type: 'image', url: mascotUrl('thinking'), size: '64px', flex: 0 } as FlexComponent,
        vbox([txt(reason, { size: 'sm', wrap: true })], { backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center' }),
      ], { spacing: 'md', alignItems: 'center' }),
      card([
        txt(`อัปเกรดเป็น ${PLANS[target].label} · ${priceLine(target)}`, { weight: 'bold', size: 'sm', wrap: true }),
        ...PLAN_PITCH[target].slice(0, 3).map((l) => txt(`✓ ${l}`, { size: 'xs', color: BRAND.muted, wrap: true })),
      ], { spacing: 'xs' }),
      vbox([
        payable
          ? button(pb(`สมัคร ${PLANS[target].label}`, 'plans'), 'primary', { height: 'sm', color: PLAN_COLOR[target] })
          : button(pb(`สนใจ ${PLANS[target].label}`, 'plan_interest', { p: target }), 'primary', { height: 'sm', color: PLAN_COLOR[target] }),
        button(pb('ดูแพ็กเกจทั้งหมด', 'plans'), 'secondary', { height: 'sm' }),
      ], { spacing: 'sm' }),
    ], { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' }),
  });
}

/** Renewal reminder (3 days before) or "your plan ended" notice. Data is never removed. */
export function renewalMessage(plan: PaidPlan, end: string, ended: boolean): FlexMessage {
  const date = new Date(end).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });
  const label = PLANS[plan].label;
  const msg = ended
    ? `ชิกชิก ${label} หมดอายุแล้วน้า ตอนนี้กลับเป็นแพ็กเกจฟรี ข้อมูลทั้งหมดยังอยู่ครบ ต่ออายุได้ทุกเมื่อ`
    : `ชิกชิก ${label} จะหมดอายุวันที่ ${date} (PromptPay ไม่ต่ออายุอัตโนมัติ) ต่ออายุตอนนี้ วันที่เหลือจะถูกบวกต่อให้ ไม่เสียเปล่า`;
  return flex(msg, {
    type: 'bubble',
    size: 'kilo',
    body: vbox([
      hbox([
        { type: 'image', url: mascotUrl(ended ? 'sleepy' : 'discipline'), size: '64px', flex: 0 } as FlexComponent,
        vbox([txt(msg, { size: 'sm', wrap: true })], { backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center' }),
      ], { spacing: 'md', alignItems: 'center' }),
      vbox([
        button(pb(`ต่ออายุรายปี ฿${PRICES[plan].yearly.toLocaleString('en-US')}`, 'pay_start', { p: plan === 'plus' ? 'plus_yearly' : 'pro_yearly' }), 'primary', { height: 'sm', color: PLAN_COLOR[plan] }),
        button(pb(`ต่ออายุรายเดือน ฿${PRICES[plan].monthly}`, 'pay_start', { p: plan === 'plus' ? 'plus_monthly' : 'pro_monthly' }), 'secondary', { height: 'sm' }),
      ], { spacing: 'sm' }),
    ], { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' }),
  });
}
