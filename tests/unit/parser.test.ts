import { describe, expect, it } from 'vitest';
import { parseIntent } from '../../src/application/parser/intent-parser.ts';
import { extractAmounts, normalizeText } from '../../src/application/parser/normalize.ts';
import { parseBareAmount, parseFixedCost, parseGoal } from '../../src/application/parser/setup-parsers.ts';

const TODAY = '2026-11-18'; // Wednesday

describe('amount extraction', () => {
  const amounts = (s: string) => extractAmounts(normalizeText(s)).map((a) => a.satang);

  it.each([
    ['กินข้าว 65', [6_500]],
    ['ค่าไฟ 1,234.50 บาท', [123_450]],
    ['เงินเดือน 25k', [2_500_000]],
    ['โบนัส 1.5 หมื่น', [1_500_000]],
    ['ข้าว ๖๕', [6_500]],
    ['กาแฟ ฿80', [8_000]],
  ])('%s', (input, expected) => {
    expect(amounts(input)).toEqual(expected);
  });

  it('ignores dates, times, counts and store names', () => {
    expect(amounts('ข้าว 2 จาน 100')).toEqual([10_000]);
    expect(amounts('เซเว่น 7-11 120')).toEqual([12_000]);
    expect(amounts('กาแฟ 18/11 80')).toEqual([8_000]);
    expect(amounts('ข้าว 7:30 50')).toEqual([5_000]);
    expect(amounts('ข้าว 3 วันก่อน 40')).toEqual([4_000]);
    expect(amounts('ข้าว 15 พ.ย. 60')).toEqual([6_000]);
  });
});

describe('parseIntent: transactions (PRD examples)', () => {
  it('"กินข้าว 65" → expense food today', () => {
    expect(parseIntent('กินข้าว 65', TODAY)).toMatchObject({
      kind: 'transaction', type: 'expense', amountSatang: 6_500, categoryId: 'food', categoryConfident: true, txnDate: TODAY,
    });
  });

  it('"เติมน้ำมัน 500" → transport', () => {
    expect(parseIntent('เติมน้ำมัน 500', TODAY)).toMatchObject({ type: 'expense', amountSatang: 50_000, categoryId: 'transport' });
  });

  it('"ได้เงินเดือน 25000" → income salary', () => {
    expect(parseIntent('ได้เงินเดือน 25000', TODAY)).toMatchObject({ kind: 'transaction', type: 'income', amountSatang: 2_500_000, categoryId: 'salary' });
  });

  it('"ซื้อกาแฟ 80 เมื่อวาน" → food dated yesterday', () => {
    expect(parseIntent('ซื้อกาแฟ 80 เมื่อวาน', TODAY)).toMatchObject({ type: 'expense', amountSatang: 8_000, categoryId: 'food', txnDate: '2026-11-17', dateIsFuture: false });
  });

  it('longest keyword wins (อาหารแมว is pet, not food)', () => {
    expect(parseIntent('อาหารแมว 350', TODAY)).toMatchObject({ categoryId: 'pet' });
  });

  it('unknown description → expense with low confidence (user must pick category)', () => {
    expect(parseIntent('ของขวัญเพื่อน 500', TODAY)).toMatchObject({ categoryId: 'family', categoryConfident: true });
    expect(parseIntent('ฟหกด 500', TODAY)).toMatchObject({ type: 'expense', categoryId: 'other_expense', categoryConfident: false });
  });

  it('income hint without keyword → other income', () => {
    expect(parseIntent('ได้รับโอน 1000', TODAY)).toMatchObject({ type: 'income', categoryId: 'other_income', categoryConfident: false });
    expect(parseIntent('แม่ให้ 1000', TODAY)).toMatchObject({ type: 'income', categoryId: 'gift_income' });
    expect(parseIntent('ได้ 1000 จากเพื่อน', TODAY)).toMatchObject({ type: 'income', categoryId: 'other_income', categoryConfident: false });
  });

  it('explicit dates: Thai month, d/m, Buddhist year, n days ago', () => {
    expect(parseIntent('ข้าว 60 15 พ.ย.', TODAY)).toMatchObject({ txnDate: '2026-11-15' });
    expect(parseIntent('ข้าว 60 1/11', TODAY)).toMatchObject({ txnDate: '2026-11-01' });
    expect(parseIntent('ข้าว 60 25/12', TODAY)).toMatchObject({ txnDate: '2025-12-25' }); // future date without year → last year
    expect(parseIntent('ข้าว 60 1/11/69', TODAY)).toMatchObject({ txnDate: '2026-11-01' });
    expect(parseIntent('ข้าว 60 1/11/2569', TODAY)).toMatchObject({ txnDate: '2026-11-01' });
    expect(parseIntent('ข้าว 60 3 วันก่อน', TODAY)).toMatchObject({ txnDate: '2026-11-15' });
    expect(parseIntent('ข้าว 60 เมื่อวานซืน', TODAY)).toMatchObject({ txnDate: '2026-11-16' });
  });

  it('flags future-dated transactions', () => {
    expect(parseIntent('ค่าห้อง 6500 พรุ่งนี้', TODAY)).toMatchObject({ txnDate: '2026-11-19', dateIsFuture: true });
  });

  it('keeps a readable note without the amount', () => {
    expect(parseIntent('ข้าวมันไก่ร้านประจำ 55', TODAY)).toMatchObject({ note: 'ข้าวมันไก่ร้านประจำ' });
  });
});

describe('parseIntent: ambiguity is never silently saved', () => {
  it('multiple amounts → ambiguous', () => {
    expect(parseIntent('ข้าว 50 กาแฟ 40', TODAY)).toMatchObject({ kind: 'ambiguous', reason: 'multiple_amounts', amounts: [5_000, 4_000] });
  });
  it('amount only → amount_only (ask what it was)', () => {
    expect(parseIntent('65', TODAY)).toEqual({ kind: 'amount_only', amountSatang: 6_500, txnDate: TODAY });
    expect(parseIntent('65 บาท เมื่อวาน', TODAY)).toEqual({ kind: 'amount_only', amountSatang: 6_500, txnDate: '2026-11-17' });
  });
  it('zero / absurd amounts → invalid', () => {
    expect(parseIntent('ข้าว 0', TODAY)).toMatchObject({ kind: 'ambiguous', reason: 'invalid_amount' });
    expect(parseIntent('ข้าว 9999999999999', TODAY)).toMatchObject({ kind: 'ambiguous', reason: 'invalid_amount' });
  });
  it('saving needs a goal', () => {
    expect(parseIntent('ออม 500', TODAY)).toMatchObject({ kind: 'ambiguous', reason: 'saving_needs_goal' });
  });
  it('gibberish without a number → unknown', () => {
    expect(parseIntent('อิอิ', TODAY)).toEqual({ kind: 'unknown' });
    expect(parseIntent('   ', TODAY)).toEqual({ kind: 'unknown' });
  });
});

describe('parseIntent: questions (PRD examples)', () => {
  it.each([
    ['วันนี้ใช้ไปเท่าไหร่', 'today_spent'],
    ['เดือนนี้เหลือเงินเท่าไหร่', 'available'],
    ['เหลือใช้อีกเท่าไร', 'available'],
    ['เดือนนี้ใช้ไปเท่าไหร่', 'month_summary'],
    ['สัปดาห์นี้ใช้ไปเท่าไหร่', 'week_summary'],
    ['มีบิลอะไรต้องจ่ายบ้าง', 'upcoming_bills'],
    ['แดชบอร์ด', 'dashboard'],
    ['ยกเลิก', 'cancel'],
    ['สวัสดีครับ', 'greeting'],
    ['ช่วยด้วย', 'help'],
  ])('%s → %s', (text, intent) => {
    expect(parseIntent(text, TODAY)).toMatchObject({ kind: 'query', intent });
  });

  it('"พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง" → upcoming bills for tomorrow', () => {
    expect(parseIntent('พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง', TODAY)).toEqual({ kind: 'query', intent: 'upcoming_bills', withinDays: 1, date: '2026-11-19' });
  });
});

describe('parseFixedCost', () => {
  it('monthly on a day: "ค่าเน็ต 599 ทุกวันที่ 5" starts next month when the day has passed', () => {
    const r = parseFixedCost('ค่าเน็ต 599 ทุกวันที่ 5', TODAY);
    expect(r).toEqual({
      ok: true,
      value: { name: 'ค่าเน็ต', amountSatang: 59_900, categoryId: 'bills', rule: { frequency: 'monthly', interval: 1, anchorDate: '2026-12-05' }, firstDueDate: '2026-12-05' },
    });
  });

  it('monthly on a later day this month starts this month', () => {
    const r = parseFixedCost('ค่าห้อง 6500 ทุกวันที่ 25', TODAY);
    expect(r.ok && r.value.firstDueDate).toBe('2026-11-25');
  });

  it('day 31 is clamped in short months but keeps its anchor day', () => {
    const r = parseFixedCost('ผ่อนรถ 8000 ทุกวันที่ 31', '2027-02-01');
    expect(r.ok && r.value.firstDueDate).toBe('2027-02-28');
  });

  it('weekly on a weekday', () => {
    const r = parseFixedCost('ยิม 300 ทุกวันจันทร์', TODAY);
    expect(r).toMatchObject({ ok: true, value: { name: 'ยิม', rule: { frequency: 'weekly', interval: 1 }, firstDueDate: '2026-11-23', categoryId: 'health' } });
  });

  it('every N days / months, yearly with date', () => {
    expect(parseFixedCost('น้ำดื่ม 60 ทุก 10 วัน', TODAY)).toMatchObject({ ok: true, value: { rule: { frequency: 'custom', interval: 10 }, firstDueDate: TODAY } });
    expect(parseFixedCost('netflix 419 ทุก 2 เดือน', TODAY)).toMatchObject({ ok: true, value: { name: 'netflix', rule: { frequency: 'monthly', interval: 2 } } });
    expect(parseFixedCost('ประกันรถ 18000 ทุกปี 10/3', TODAY)).toMatchObject({ ok: true, value: { rule: { frequency: 'yearly' }, firstDueDate: '2027-03-10' } });
  });

  it('reports what is missing', () => {
    expect(parseFixedCost('ค่าเน็ต 599', TODAY)).toEqual({ ok: false, error: 'no_schedule' });
    expect(parseFixedCost('ค่าเน็ต ทุกเดือน', TODAY)).toEqual({ ok: false, error: 'no_amount' });
    expect(parseFixedCost('599 ทุกเดือน', TODAY)).toEqual({ ok: false, error: 'no_name' });
  });
});

describe('parseGoal and parseBareAmount', () => {
  it('goal with monthly reserve', () => {
    expect(parseGoal('เที่ยวญี่ปุ่น 30000 เดือนละ 3000')).toEqual({ ok: true, value: { name: 'เที่ยวญี่ปุ่น', targetSatang: 3_000_000, monthlyReserveSatang: 300_000 } });
    expect(parseGoal('เงินสำรองฉุกเฉิน 1 แสน')).toEqual({ ok: true, value: { name: 'เงินสำรองฉุกเฉิน', targetSatang: 10_000_000, monthlyReserveSatang: 0 } });
    expect(parseGoal('30000')).toEqual({ ok: false, error: 'no_name' });
  });

  it('bare amount', () => {
    expect(parseBareAmount('5000')).toBe(500_000);
    expect(parseBareAmount('5,000 บาท')).toBe(500_000);
    expect(parseBareAmount('5k')).toBe(500_000);
    expect(parseBareAmount('ข้าว 50')).toBeNull();
    expect(parseBareAmount('0')).toBeNull();
  });
});
