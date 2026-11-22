/**
 * Income & expense statement ("รายงานรายรับรายจ่าย") for a date range: totals, a month-by-month
 * table, category breakdowns and every entry. Used for the printable/PDF report and the Excel
 * (CSV) download — e.g. to show a lender or an accountant. Pure, integer satang.
 */
import { addDays, diffDays, formatThaiShort, type LocalDate } from '../dates.ts';
import { getCategory } from '../entities/categories.ts';
import type { Transaction } from '../entities/index.ts';
import { formatSatang, ratioBasisPoints, type Satang } from '../money.ts';
import { summarizeTransactions, type DateRange } from './summary.ts';

/** Longest range in one report (a year, leap-safe). */
export const STATEMENT_MAX_DAYS = 366;

export interface StatementMonth {
  key: string; // YYYY-MM
  incomeSatang: Satang;
  expenseSatang: Satang;
  savingSatang: Satang;
  netSatang: Satang;
}
export interface StatementCategory {
  categoryId: string;
  label: string;
  amountSatang: Satang;
  count: number;
  shareBasisPoints: number;
}
export interface StatementRow {
  date: LocalDate;
  type: Transaction['type'];
  categoryLabel: string;
  note: string | null;
  amountSatang: Satang;
}
export interface Statement {
  range: DateRange;
  days: number;
  incomeSatang: Satang;
  expenseSatang: Satang;
  savingSatang: Satang;
  netSatang: Satang;
  /** income − expense, in basis points of income; null without income */
  keptRateBp: number | null;
  months: StatementMonth[];
  incomeByCategory: StatementCategory[];
  expenseByCategory: StatementCategory[];
  rows: StatementRow[];
}

export function validateStatementRange(from: LocalDate, to: LocalDate): string | null {
  if (to < from) return 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด';
  if (diffDays(from, to) + 1 > STATEMENT_MAX_DAYS) return `เลือกช่วงได้ไม่เกิน ${STATEMENT_MAX_DAYS} วันต่อรายงาน`;
  return null;
}

function categories(list: ReturnType<typeof summarizeTransactions>['expenseByCategory'], total: Satang): StatementCategory[] {
  return list.map((c) => ({ categoryId: c.categoryId, label: getCategory(c.categoryId).labelTh, amountSatang: c.amountSatang, count: c.count, shareBasisPoints: ratioBasisPoints(c.amountSatang, total) }));
}

export function buildStatement(txns: readonly Transaction[], range: DateRange): Statement {
  const t = summarizeTransactions(txns, range);
  const months: StatementMonth[] = [];
  for (let start = range.start; start <= range.end; ) {
    const key = start.slice(0, 7);
    const monthEnd = addDays(`${key}-01`, 40).slice(0, 7) + '-01';
    const end = addDays(monthEnd, -1) < range.end ? addDays(monthEnd, -1) : range.end;
    const m = summarizeTransactions(txns, { start, end });
    months.push({ key, incomeSatang: m.incomeSatang, expenseSatang: m.expenseSatang, savingSatang: m.savingSatang, netSatang: m.netSatang });
    start = addDays(end, 1);
  }
  const rows = txns
    .filter((x) => x.deletedAt === null && x.txnDate >= range.start && x.txnDate <= range.end)
    .slice()
    .sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.createdAt.localeCompare(b.createdAt))
    .map((x) => ({ date: x.txnDate, type: x.type, categoryLabel: getCategory(x.categoryId).labelTh, note: x.note, amountSatang: x.amountSatang }));
  return {
    range,
    days: diffDays(range.start, range.end) + 1,
    incomeSatang: t.incomeSatang,
    expenseSatang: t.expenseSatang,
    savingSatang: t.savingSatang,
    netSatang: t.netSatang,
    keptRateBp: t.incomeSatang > 0 ? ratioBasisPoints(Math.max(0, t.incomeSatang - t.expenseSatang), t.incomeSatang) : null,
    months,
    incomeByCategory: categories(t.incomeByCategory, t.incomeSatang),
    expenseByCategory: categories(t.expenseByCategory, t.expenseSatang),
    rows,
  };
}

/**
 * One CSV cell. Quotes when needed and neutralises spreadsheet formulas: a note like
 * `=HYPERLINK(...)` would otherwise run when the file is opened in Excel/Sheets.
 */
export function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  // plain numbers (incl. negatives like -3000.00) are data, not formulas
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const TYPE_TH: Record<Transaction['type'], string> = { income: 'รายรับ', expense: 'รายจ่าย', saving: 'เงินออม' };
const baht = (s: Satang) => formatSatang(s, { alwaysShowFraction: true }).replace(/,/g, '');
const line = (cells: Array<string | number | null>) => cells.map(csvCell).join(',');

/** Excel-friendly CSV (UTF-8 BOM so Thai displays correctly). Amounts are plain numbers in baht. */
export function statementToCsv(s: Statement, meta: { name: string | null; generatedOn: LocalDate }): string {
  const out: string[] = [
    line(['รายงานรายรับรายจ่าย — ShikSheek ชิกชิก']),
    line(['ชื่อ', meta.name ?? '-']),
    line(['ช่วงวันที่', `${formatThaiShort(s.range.start, true)} – ${formatThaiShort(s.range.end, true)}`]),
    line(['สร้างเมื่อ', formatThaiShort(meta.generatedOn, true)]),
    '',
    line(['สรุป', 'บาท']),
    line(['รายรับรวม', baht(s.incomeSatang)]),
    line(['รายจ่ายรวม', baht(s.expenseSatang)]),
    line(['โอนเข้าเงินออม', baht(s.savingSatang)]),
    line(['คงเหลือสุทธิ', baht(s.netSatang)]),
    '',
    line(['เดือน', 'รายรับ', 'รายจ่าย', 'เงินออม', 'คงเหลือสุทธิ']),
    ...s.months.map((m) => line([m.key, baht(m.incomeSatang), baht(m.expenseSatang), baht(m.savingSatang), baht(m.netSatang)])),
    '',
    line(['รายจ่ายตามหมวด', 'บาท', 'จำนวนรายการ', 'สัดส่วน %']),
    ...s.expenseByCategory.map((c) => line([c.label, baht(c.amountSatang), c.count, (c.shareBasisPoints / 100).toFixed(2)])),
    '',
    line(['รายรับตามหมวด', 'บาท', 'จำนวนรายการ', 'สัดส่วน %']),
    ...s.incomeByCategory.map((c) => line([c.label, baht(c.amountSatang), c.count, (c.shareBasisPoints / 100).toFixed(2)])),
    '',
    line(['วันที่', 'ประเภท', 'หมวด', 'บันทึก', 'จำนวนเงิน (บาท)']),
    ...s.rows.map((r) => line([r.date, TYPE_TH[r.type], r.categoryLabel, r.note, baht(r.amountSatang)])),
  ];
  return `﻿${out.join('\r\n')}\r\n`;
}
