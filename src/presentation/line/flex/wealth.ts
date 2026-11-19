/**
 * Savings-first templates: the money ladder ("แผนการเงิน"), "เก็บก่อนใช้" after income, and the
 * month-end leftover sweep. Growth guidance is general education, never a product recommendation.
 */
import type { WealthPlan } from '../../../application/services/wealth-service.ts';
import { EMERGENCY_MONTHS, SAVE_FIRST_PERCENTS, TARGET_SAVINGS_RATE_BP, percentOf } from '../../../domain/calculations/wealth.ts';
import type { SavingsGoal, Transaction } from '../../../domain/entities/index.ts';
import { formatBaht, type Satang } from '../../../domain/money.ts';
import type { FlexComponent, FlexMessage } from '../../../infrastructure/line/messages.ts';
import { mascotUrl } from '../mascot.ts';
import { pb } from './actions.ts';
import { flex } from './common.ts';
import { BRAND, bubble, button, card, hbox, header, progressBar, txt, vbox } from './theme.ts';

const pct = (bp: number | null) => (bp === null ? '–' : `${Math.round(bp / 100)}%`);

function stepRow(n: number, title: string, detail: string, state: 'done' | 'now' | 'later', extra: FlexComponent[] = []): FlexComponent {
  const icon = state === 'done' ? '✅' : state === 'now' ? '👉' : '⚪';
  return vbox(
    [
      hbox([txt(icon, { flex: 0, size: 'sm' }), txt(`${n}. ${title}`, { weight: 'bold', size: 'sm', flex: 1, wrap: true, color: state === 'later' ? BRAND.muted : BRAND.brown })], { spacing: 'sm' }),
      txt(detail, { size: 'xs', color: BRAND.muted, wrap: true }),
      ...extra,
    ],
    { spacing: 'xs' },
  );
}

const NEXT: Record<WealthPlan['step'], string> = {
  1: 'สร้างเงินสำรองฉุกเฉินก่อน เผื่อเหตุไม่คาดฝัน (ตกงาน ป่วย รถเสีย)',
  2: 'เงินสำรองครบแล้ว! ต่อไปตั้งใจเก็บให้ได้ 20% ของรายรับทุกเดือน',
  3: 'ออมได้สม่ำเสมอแล้ว เติมเป้าหมายของคุณให้ครบทีละเป้า',
  4: 'ยอดเยี่ยม! พร้อมศึกษาการต่อยอดเงินระยะยาวแล้ว',
};

export function wealthPlanMessage(p: WealthPlan): FlexMessage {
  const target = p.emergencyTargetSatang;
  const saved = p.emergency?.savedSatang ?? 0;
  const emergencyBp = target ? Math.min(10_000, Math.round((saved * 10_000) / target)) : 0;
  const rateBp = p.savingsRateBp ?? 0;
  const s = (n: number) => (p.step > n ? 'done' : p.step === n ? 'now' : 'later') as 'done' | 'now' | 'later';
  const openGoals = p.goals.filter((g) => !g.isReached && g !== p.emergency);
  const body: FlexComponent[] = [
    card(
      [
        hbox([txt('เดือนนี้เก็บได้', { size: 'sm', flex: 6 }), txt(`${formatBaht(p.savingSatang)} · ${pct(p.savingsRateBp)}`, { size: 'sm', weight: 'bold', align: 'end', flex: 5 })]),
        progressBar(Math.min(10_000, Math.round((rateBp * 10_000) / TARGET_SAVINGS_RATE_BP)), rateBp >= TARGET_SAVINGS_RATE_BP ? BRAND.green : BRAND.yellow),
        txt(p.incomeSatang > 0 ? `เป้า 20% ของรายรับ = ${formatBaht(percentOf(p.incomeSatang, 20))}` : 'ยังไม่มีรายรับเดือนนี้ จดรายรับก่อนน้า', { size: 'xs', color: BRAND.muted, wrap: true }),
      ],
      { spacing: 'sm' },
    ),
    card(
      [
        txt('บันไดการเงิน 4 ขั้น', { weight: 'bold', size: 'sm' }),
        stepRow(
          1,
          `เงินสำรองฉุกเฉิน ${EMERGENCY_MONTHS} เดือน`,
          target ? `${formatBaht(saved)} / ${formatBaht(target)} (จากค่าใช้จ่ายเฉลี่ย ${formatBaht(p.avgMonthlyExpenseSatang ?? 0)}/เดือน)` : 'จดรายจ่ายสักเดือน ชิกชิกจะคำนวณเป้าให้',
          s(1),
          target ? [progressBar(emergencyBp, emergencyBp >= 10_000 ? BRAND.green : BRAND.red)] : [],
        ),
        stepRow(2, 'เก็บก่อนใช้ 20% ทุกเดือน', `เดือนนี้ ${pct(p.savingsRateBp)} — พอเงินเข้า ชิกชิกจะชวนเก็บก่อนทันที`, s(2)),
        stepRow(3, 'เติมเป้าหมายของคุณ', openGoals.length ? openGoals.slice(0, 2).map((g) => `${g.goal.name} ${Math.round(g.progressBasisPoints / 100)}%`).join(' · ') : 'ตั้งเป้า เช่น เที่ยว ดาวน์บ้าน ซื้อรถ', s(3)),
        stepRow(4, 'ต่อยอดระยะยาว', 'ศึกษาการออม/ลงทุนระยะยาวด้วยเงินที่ไม่ต้องใช้ใน 5 ปี เช่น กองทุนลดหย่อนภาษี กองทุนรวมดัชนี กระจายความเสี่ยงเสมอ', s(4)),
      ],
      { spacing: 'md' },
    ),
    txt(`👉 ${NEXT[p.step]}`, { size: 'sm', wrap: true, weight: 'bold' }),
    txt('ข้อมูลทั่วไปเพื่อการวางแผน ไม่ใช่คำแนะนำการลงทุน', { size: 'xxs', color: BRAND.muted, wrap: true }),
  ];
  const primary =
    p.emergency || p.goals.length
      ? button(pb('เก็บเงินตอนนี้', 'goal_contribute', { id: (p.emergency && !p.emergency.isReached ? p.emergency : (openGoals[0] ?? p.emergency ?? p.goals[0])!).goal.id }), 'primary')
      : button(pb('เริ่มเงินสำรองฉุกเฉิน', 'wealth_emergency'), 'primary');
  return flex(`แผนการเงิน: เก็บได้ ${pct(p.savingsRateBp)} ของรายรับ`, bubble({
    header: header('แผนการเงิน', 'มีเงินเหลือเก็บ แล้วต่อยอด', mascotUrl(p.step >= 3 ? 'proud' : 'planning')),
    body,
    footer: [primary, hbox([button(pb('เป้าออม', 'goals'), 'secondary', { flex: 1, height: 'sm' }), button(pb('งบประมาณ', 'budgets'), 'secondary', { flex: 1, height: 'sm' })], { spacing: 'sm' })],
  }));
}

/** Right after income is saved: offer to move 10/20/30% into savings first. */
export function saveFirstMessage(income: Transaction): FlexMessage {
  const msg = `เงินเข้า ${formatBaht(income.amountSatang)} 🎉 เก็บก่อนใช้ไหม? คนที่เก็บก่อนมักมีเงินเหลือมากกว่าคนที่รอเก็บตอนสิ้นเดือน`;
  return flex(msg, {
    type: 'bubble',
    size: 'kilo',
    body: vbox(
      [
        hbox(
          [
            { type: 'image', url: mascotUrl('saving'), size: '64px', flex: 0 } as FlexComponent,
            vbox([txt(msg, { size: 'sm', wrap: true })], { backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center' }),
          ],
          { spacing: 'md', alignItems: 'center' },
        ),
        vbox(
          SAVE_FIRST_PERCENTS.map((n) =>
            button(pb(`เก็บ ${n}% · ${formatBaht(percentOf(income.amountSatang, n))}`, 'save_first', { id: income.id, p: String(n) as '10' | '20' | '30' }), n === 20 ? 'primary' : 'secondary', { height: 'sm' }),
          ),
          { spacing: 'sm' },
        ),
        txt('แตะเพื่อย้ายเข้าเงินสำรอง/เป้าออม (ยกเลิกได้ในประวัติ)', { size: 'xxs', color: BRAND.muted, align: 'center', wrap: true }),
      ],
      { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' },
    ),
  });
}

/** After a period ends with money left: sweep all/half of it into savings. */
export function sweepMessage(periodKey: string, leftover: Satang): FlexMessage {
  const msg = `รอบที่แล้วเหลือ ${formatBaht(leftover)} 🎉 เก่งมาก! ย้ายเข้าเงินเก็บเลยไหม จะได้ไม่เผลอใช้`;
  return flex(msg, {
    type: 'bubble',
    size: 'kilo',
    body: vbox(
      [
        hbox(
          [
            { type: 'image', url: mascotUrl('celebrating'), size: '64px', flex: 0 } as FlexComponent,
            vbox([txt(msg, { size: 'sm', wrap: true })], { backgroundColor: BRAND.white, cornerRadius: '14px', paddingAll: '12px', flex: 1, justifyContent: 'center' }),
          ],
          { spacing: 'md', alignItems: 'center' },
        ),
        vbox(
          [
            button(pb(`เก็บทั้งหมด ${formatBaht(leftover)}`, 'sweep', { k: periodKey, f: 'all' }), 'primary', { height: 'sm' }),
            button(pb(`เก็บครึ่งหนึ่ง ${formatBaht(percentOf(leftover, 50))}`, 'sweep', { k: periodKey, f: 'half' }), 'secondary', { height: 'sm' }),
          ],
          { spacing: 'sm' },
        ),
      ],
      { backgroundColor: BRAND.cream, paddingAll: '12px', spacing: 'md' },
    ),
  });
}

export function savedToGoalText(goal: SavingsGoal, amount: Satang, createdGoal: boolean): string {
  return `${createdGoal ? `สร้างเป้า "${goal.name}" ให้แล้ว และ` : ''}เก็บ ${formatBaht(amount)} เข้า "${goal.name}" แล้ว 🐷 เงินก้อนนี้ไม่นับในยอดใช้ได้นะ`;
}
