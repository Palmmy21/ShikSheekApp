import { describe, expect, it } from 'vitest';
import { parsePrintedAmount, prepareImport, summarizeRows } from '../../src/application/services/import-service.ts';
import type { DocExtraction, DocRow } from '../../src/infrastructure/ai/claude.ts';

const TODAY = '2026-11-18';
const row = (p: Partial<DocRow> = {}): DocRow => ({ type: 'expense', amount_text: '120.00', date: TODAY, description: 'ร้านข้าวมันไก่', category_id: 'food', reference: null, ...p });
const ex = (kind: DocExtraction['kind'], rows: DocRow[]): DocExtraction => ({ kind, rows });

describe('parsePrintedAmount (exact, no floats)', () => {
  it.each([
    ['1,250.00', 125_000],
    ['฿ 80', 8_000],
    ['80.50 บาท', 8_050],
    ['-1,250.00', 125_000],
    ['+500.00', 50_000],
    ['THB 19.99', 1_999],
  ])('%s → %i', (text, satang) => expect(parsePrintedAmount(text)).toBe(satang));

  it.each(['', 'abc', '0.00', '1.234', '12,34', '1e3'])('rejects %j', (text) => expect(parsePrintedAmount(text)).toBeNull());
});

describe('prepareImport', () => {
  it('slip with a reference → one row keyed by the normalized reference', async () => {
    const p = await prepareImport(ex('transfer_slip', [row({ reference: '0123 4567-ABCD xyz' })]), TODAY);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ amountSatang: 12_000, externalRef: 'ref:01234567ABCDXYZ', categoryConfident: true, dateGuessed: false });
  });

  it('slip without a reference has no dedupe key (two identical coffees are both allowed)', async () => {
    const p = await prepareImport(ex('transfer_slip', [row()]), TODAY);
    expect(p.rows[0]!.externalRef).toBeNull();
  });

  it('slip with an unreadable or out-of-range date falls back to today and flags it', async () => {
    for (const date of [null, '2026-13-40', '2020-01-01', '2027-06-01']) {
      const p = await prepareImport(ex('receipt', [row({ date })]), TODAY);
      expect(p.rows[0]).toMatchObject({ txnDate: TODAY, dateGuessed: true });
    }
  });

  it('statement rows without a trustworthy date are skipped, never guessed', async () => {
    const p = await prepareImport(ex('statement', [row(), row({ date: null }), row({ date: '2019-01-01' })]), TODAY);
    expect(p.rows).toHaveLength(1);
    expect(p.skipped).toBe(2);
  });

  it('unparseable amounts are skipped', async () => {
    const p = await prepareImport(ex('statement', [row({ amount_text: 'ยอดคงเหลือ' }), row()]), TODAY);
    expect(p.rows).toHaveLength(1);
    expect(p.skipped).toBe(1);
  });

  it('identical statement lines get distinct but stable fingerprints', async () => {
    const lines = [row({ description: 'Starbucks' }), row({ description: '  STARBUCKS ' }), row({ description: 'Starbucks', amount_text: '95.00' })];
    const a = await prepareImport(ex('statement', lines), TODAY);
    const b = await prepareImport(ex('statement', lines), TODAY);
    const refs = a.rows.map((r) => r.externalRef);
    expect(new Set(refs).size).toBe(3);
    expect(b.rows.map((r) => r.externalRef)).toEqual(refs); // re-importing the same statement → same keys
  });

  it('wrong-kind categories fall back to the default and are marked unsure', async () => {
    const p = await prepareImport(ex('receipt', [row({ type: 'income', category_id: 'food' })]), TODAY);
    expect(p.rows[0]).toMatchObject({ categoryId: 'other_income', categoryConfident: false });
  });

  it('summarizes totals and date range', async () => {
    const p = await prepareImport(ex('statement', [row({ date: '2026-11-01' }), row({ type: 'income', amount_text: '25,000.00', category_id: 'salary', date: '2026-11-15' })]), TODAY);
    expect(summarizeRows(p.rows)).toEqual({ count: 2, incomeSatang: 2_500_000, expenseSatang: 12_000, firstDate: '2026-11-01', lastDate: '2026-11-15' });
  });
});
