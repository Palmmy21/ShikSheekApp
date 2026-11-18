/**
 * Plan templates: "แพ็กเกจของฉัน" (status + usage + Plus/Pro cards) and the soft upgrade card shown
 * when a limit is reached. No payment yet: "สนใจ" records interest for the launch.
 */
import type { PlanLimitError, PlanStatus, PlanUsage } from '../../../application/services/entitlement-service.ts';
import { PLAN_PITCH, PLANS, PRICES, upgradeTarget, type PaidPlan } from '../../../domain/plans.ts';
import type { FlexBubble, FlexComponent, FlexMessage } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, pill, progressBar, txt, vbox } from './theme.ts';

const PLAN_COLOR: Record<PaidPlan, string> = { plus: BRAND.red, pro: '#6B4FD8' };

function priceLine(p: PaidPlan): string {
  return `฿${PRICES[p].monthly}/เดือน · ฿${PRICES[p].yearly.toLocaleString('en-US')}/ปี`;
}

function planCard(p: PaidPlan, current: boolean): FlexBubble {
  return bubble({
    size: 'kilo',
    header: header(`ชิกชิก ${PLANS[p].label}`, priceLine(p), mascotUrl(p === 'pro' ? 'proud' : 'celebrating'), { bg: p === 'pro' ? '#EEE9FF' : undefined }),
    body: [
      vbox(PLAN_PITCH[p].map((line) => hbox([txt('✓', { flex: 0, color: PLAN_COLOR[p], weight: 'bold', size: 'sm' }), txt(line, { size: 'sm', wrap: true, flex: 1 })], { spacing: 'sm' })), { spacing: 'sm' }),
      ...(p === 'plus' ? [txt(`🐣 ผู้ใช้กลุ่มแรก: ฿${PRICES.plus.earlyBirdYearly}/ปี ล็อกราคาตลอด`, { size: 'xs', color: BRAND.muted, wrap: true })] : []),
    ],
    footer: [current ? button(pb('แพ็กเกจปัจจุบัน', 'plans'), 'secondary') : button(pb(`สนใจ ${PLANS[p].label}`, 'plan_interest', { p }), 'primary', { color: PLAN_COLOR[p] })],
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

export function planStatusMessage(s: PlanStatus, u: PlanUsage): FlexMessage {
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
  });
  const paidNow = s.source === 'paid' ? s.plan : null;
  return flex(`แพ็กเกจ ${s.limits.label}`, { type: 'carousel', contents: [status, planCard('plus', paidNow === 'plus'), planCard('pro', paidNow === 'pro')] });
}

const REASON: Record<PlanLimitError['feature'], (limit: number | null, plan: string) => string> = {
  fixed_costs: (n, plan) => `แพ็กเกจ${plan}ตั้งบิลประจำได้ ${n} รายการ ครบแล้วน้า`,
  goals: (n, plan) => `แพ็กเกจ${plan}ตั้งเป้าออมได้ ${n} เป้า ครบแล้วน้า`,
  category_budget: () => 'แพ็กเกจฟรีตั้งได้เฉพาะ "งบรวมทั้งเดือน" งบรายหมวดเป็นของ Plus น้า',
  docs: (n) => `เดือนนี้อ่านสลิป/PDF ครบ ${n} ครั้งแล้ว (เริ่มนับใหม่วันที่ 1) ระหว่างนี้พิมพ์รายการเองได้เลย`,
  history: (n) => `แพ็กเกจฟรีดูรายงานย้อนหลังได้ ${n} เดือน`,
};

export function planLimitMessage(err: PlanLimitError): FlexMessage {
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
      hbox([
        button(pb('ดูแพ็กเกจ', 'plans'), 'secondary', { flex: 1, height: 'sm' }),
        button(pb(`สนใจ ${PLANS[target].label}`, 'plan_interest', { p: target }), 'primary', { flex: 1, height: 'sm', color: PLAN_COLOR[target] }),
      ], { spacing: 'sm' }),
    ], { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' }),
  });
}
