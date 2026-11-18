/**
 * Dashboard, reports menu and daily/weekly/monthly summaries.
 */
import { formatThaiMonthYear, formatThaiShort, parseLocalDate, type LocalDate } from '../../../domain/dates.ts';
import { getCategory } from '../../../domain/entities/categories.ts';
import { formatBaht, ratioBasisPoints } from '../../../domain/money.ts';
import type { DashboardView, SummaryView } from '../../../application/services/finance-service.ts';
import type { FlexComponent, FlexMessage } from '../../../infrastructure/line/messages.ts';
import { mascotUrl, moodForAvailable, type MascotExpression } from '../mascot.ts';
import { pb } from './actions.ts';
import { liffLink } from '../links.ts';
import { budgetRow } from './budgets-goals.ts';
import { flex } from './common.ts';
import { billLine } from './fixed-costs.ts';
import { BRAND, bubble, button, card, hbox, header, progressBar, row, sep, txt, vbox } from './theme.ts';

function periodTitle(start: LocalDate, end: LocalDate): string {
  const s = parseLocalDate(start);
  if (s.day === 1) return formatThaiMonthYear(s.year, s.month);
  return `${formatThaiShort(start)} – ${formatThaiShort(end)}`;
}

export function dashboardMessage(v: DashboardView, comment: string): FlexMessage {
  const a = v.available;
  const mood = moodForAvailable(a);
  const big = card([
    txt('ใช้ได้อีก', { size: 'xs', color: BRAND.muted }),
    txt(formatBaht(a.availableSatang), { size: '3xl', weight: 'bold', color: a.isNegative ? BRAND.red : BRAND.brown }),
    txt(
      a.dailyAllowanceSatang > 0
        ? `เฉลี่ยวันละ ${formatBaht(a.dailyAllowanceSatang)} · เหลือ ${a.daysRemaining} วัน`
        : a.isNegative ? `ติดลบอยู่ · เหลือ ${a.daysRemaining} วันในรอบนี้` : `เหลือ ${a.daysRemaining} วันในรอบนี้`,
      { size: 'xs', color: BRAND.muted },
    ),
  ], { paddingAll: '16px' });

  const breakdown = card([
    row('รายรับ', formatBaht(a.incomeSatang), { valueColor: BRAND.green }),
    row('ใช้ไปแล้ว', formatBaht(a.expenseSatang)),
    ...(a.unpaidFixedCostsSatang > 0 ? [row(`บิลที่ยังไม่จ่าย (${a.unpaidFixedCostCount})`, formatBaht(a.unpaidFixedCostsSatang))] : []),
    ...(a.savingContributedSatang + a.savingsReservedSatang > 0
      ? [row('ออม/กันไว้ออม', formatBaht(a.savingContributedSatang + a.savingsReservedSatang))]
      : []),
    sep({ margin: 'sm' }),
    row('วันนี้ใช้ไป', formatBaht(v.todayExpenseSatang), { bold: true }),
  ]);

  const sections: FlexComponent[] = [big, breakdown];
  if (v.upcomingBills.length) {
    sections.push(
      card([txt('บิลใกล้ถึง', { weight: 'bold', size: 'sm' }), ...v.upcomingBills.slice(0, 3).map((b) => billLine(b, v.fixedCostNames[b.fixedCostId] ?? 'บิล'))]),
    );
  }
  if (v.budgets.length) {
    sections.push(card([txt('งบประมาณ', { weight: 'bold', size: 'sm' }), ...v.budgets.slice(0, 2).map(budgetRow)]));
  }
  sections.push(txt(comment, { size: 'sm', color: BRAND.brown }));

  return flex(
    `ภาพรวม: ใช้ได้อีก ${formatBaht(a.availableSatang)}`,
    bubble({
      header: header('ภาพรวม', periodTitle(v.period.start, v.period.end), mascotUrl(mood)),
      body: sections,
      footer: [
        hbox([
          button(pb('✍️ จดรายจ่าย', 'add_expense'), 'primary', { flex: 1 }),
          button(pb('📊 รายงาน', 'reports'), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
        ...(liffLink() ? [button({ type: 'uri', label: '📱 เปิดแอปดูละเอียด', uri: liffLink()! }, 'link')] : []),
      ],
    }),
  );
}

export function noIncomeHint(): FlexComponent {
  return txt('ยังไม่มีรายรับในรอบนี้ — พิมพ์ "ได้เงินเดือน 25000" เพื่อเริ่ม', { size: 'xs', color: BRAND.deepRed });
}

export function reportsMenuMessage(previousPeriodKey: string): FlexMessage {
  return flex(
    'เลือกรายงาน',
    bubble({
      header: header('รายงาน', 'อยากดูช่วงไหนดี?', mascotUrl('smart')),
      body: [txt('สรุปรายรับรายจ่าย เทียบกับช่วงก่อน และหมวดที่ใช้เยอะสุด')],
      footer: [
        hbox([
          button(pb('วันนี้', 'report_daily', {}), 'primary', { flex: 1 }),
          button(pb('สัปดาห์นี้', 'report_weekly'), 'primary', { flex: 1 }),
        ], { spacing: 'sm' }),
        hbox([
          button(pb('เดือนนี้', 'report_monthly', {}), 'primary', { flex: 1 }),
          button(pb('เดือนก่อน', 'report_monthly', { k: previousPeriodKey }), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
        hbox([
          button(pb('📜 ประวัติรายการ', 'txn_history', { p: 0 }), 'secondary', { flex: 1 }),
          button(pb('🎯 เป้าหมายออม', 'goals'), 'secondary', { flex: 1 }),
        ], { spacing: 'sm' }),
      ],
    }),
  );
}

const LABEL = { day: 'สรุปวันนี้', week: 'สรุปสัปดาห์นี้', month: 'สรุปรอบเดือน' } as const;
const PREV_LABEL = { day: 'เมื่อวาน', week: 'สัปดาห์ก่อน (ช่วงเดียวกัน)', month: 'รอบก่อน' } as const;

export function summaryMessage(v: SummaryView, comment: string, mascot: MascotExpression, opts: { titleOverride?: string } = {}): FlexMessage {
  const t = v.totals;
  const title = opts.titleOverride ?? (v.label === 'day' ? formatThaiShort(v.start, true) : v.label === 'week' ? `${formatThaiShort(v.start)} – ${formatThaiShort(v.end)}` : periodTitle(v.start, v.end));

  const top = t.expenseByCategory.slice(0, 5).map((c) => {
    const cat = getCategory(c.categoryId);
    const bp = ratioBasisPoints(c.amountSatang, t.expenseSatang);
    return vbox([
      hbox([
        txt(`${cat.emoji} ${cat.labelTh}`, { size: 'sm', flex: 6 }),
        txt(formatBaht(c.amountSatang), { size: 'sm', align: 'end', flex: 4, weight: 'bold' }),
      ]),
      progressBar(bp, BRAND.red),
    ], { spacing: 'xs' });
  });

  const change = v.expenseChangeSatang;
  const changeText =
    change === null || v.previousTotals === null
      ? null
      : change === 0
        ? `เท่ากับ${PREV_LABEL[v.label]}`
        : `${change > 0 ? '▲ มากกว่า' : '▼ น้อยกว่า'}${PREV_LABEL[v.label]} ${formatBaht(Math.abs(change))}`;

  const body: FlexComponent[] = [
    card([
      txt('ใช้ไป', { size: 'xs', color: BRAND.muted }),
      txt(formatBaht(t.expenseSatang), { size: 'xxl', weight: 'bold' }),
      ...(changeText ? [txt(changeText, { size: 'xs', color: change! > 0 ? BRAND.red : BRAND.green })] : []),
      sep({ margin: 'md' }),
      row('รายรับ', formatBaht(t.incomeSatang), { valueColor: BRAND.green }),
      ...(t.savingSatang ? [row('ออม', formatBaht(t.savingSatang))] : []),
      row('คงเหลือสุทธิ', formatBaht(t.netSatang), { bold: true, valueColor: t.netSatang < 0 ? BRAND.red : BRAND.brown }),
      ...(v.available ? [row('ใช้ได้อีก (รอบนี้)', formatBaht(v.available.availableSatang), { bold: true, valueColor: v.available.isNegative ? BRAND.red : BRAND.brown })] : []),
    ]),
  ];
  if (top.length) body.push(card([txt('ใช้กับอะไรบ้าง', { weight: 'bold', size: 'sm' }), ...top], { spacing: 'md' }));
  else body.push(txt(t.transactionCount ? 'ไม่มีรายจ่ายในช่วงนี้ 🎉' : 'ยังไม่มีรายการในช่วงนี้', { size: 'sm', color: BRAND.muted }));
  if (v.budgets.length) body.push(card([txt('งบประมาณ', { weight: 'bold', size: 'sm' }), ...v.budgets.slice(0, 3).map(budgetRow)]));
  body.push(txt(comment, { size: 'sm' }));

  return flex(
    `${LABEL[v.label]}: ใช้ไป ${formatBaht(t.expenseSatang)}`,
    bubble({
      header: header(LABEL[v.label], title, mascotUrl(mascot)),
      body,
      footer: [hbox([button(pb('ภาพรวม', 'dashboard'), 'primary', { flex: 1 }), button(pb('รายงานอื่น', 'reports'), 'secondary', { flex: 1 })], { spacing: 'sm' })],
    }),
  );
}
