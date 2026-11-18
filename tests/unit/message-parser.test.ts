import { describe, expect, it } from 'vitest';
import { parseMessage } from '../../src/application/parser/message-parser.ts';

const TODAY = '2026-11-18';

describe('multi-item messages', () => {
  it('splits by amounts: "ข้าว 50 กาแฟ 40"', () => {
    const r = parseMessage('ข้าว 50 กาแฟ 40', TODAY);
    expect(r.kind).toBe('multi');
    if (r.kind !== 'multi') return;
    expect(r.items.map((i) => [i.amountSatang, i.categoryId])).toEqual([[5_000, 'food'], [4_000, 'food']]);
  });

  it('splits by lines and commas, mixing income and expense', () => {
    const r = parseMessage('ได้เงินเดือน 25000\nเติมน้ำมัน 500, ค่าเน็ต 599', TODAY);
    expect(r.kind === 'multi' && r.items.map((i) => [i.type, i.amountSatang, i.categoryId])).toEqual([
      ['income', 2_500_000, 'salary'],
      ['expense', 50_000, 'transport'],
      ['expense', 59_900, 'bills'],
    ]);
  });

  it('one date phrase applies to every item', () => {
    const r = parseMessage('เมื่อวาน ข้าว 50 กาแฟ 40', TODAY);
    expect(r.kind === 'multi' && r.items.map((i) => i.txnDate)).toEqual(['2026-11-17', '2026-11-17']);
  });

  it('splits on "และ" / "กับ"', () => {
    const r = parseMessage('ข้าวมันไก่ 55 กับ ชาไข่มุก 45', TODAY);
    expect(r.kind === 'multi' && r.items.length).toBe(2);
  });

  it('pieces without a label stay ambiguous (never guessed)', () => {
    expect(parseMessage('50 40', TODAY).kind).toBe('ambiguous');
    expect(parseMessage('ข้าว 50 40', TODAY).kind).toBe('ambiguous');
  });

  it('single item still goes through the normal parser', () => {
    expect(parseMessage('กินข้าว 65', TODAY)).toMatchObject({ kind: 'transaction', amountSatang: 6_500 });
  });
});

describe('commands', () => {
  it.each([
    ['ลบรายการล่าสุด', { command: 'delete_last' }],
    ['ยกเลิกเมื่อกี้', { command: 'delete_last' }],
    ['แก้ล่าสุดเป็น 80', { command: 'edit_last', amountSatang: 8_000 }],
    ['ตั้งงบอาหาร 6000', { command: 'set_budget', categoryId: 'food', amountSatang: 600_000 }],
    ['ตั้งงบรวม 20000', { command: 'set_budget', categoryId: 'total', amountSatang: 2_000_000 }],
    ['ตั้งงบค่าเดินทาง เดือนละ 3000', { command: 'set_budget', categoryId: 'transport', amountSatang: 300_000 }],
    ['เปิดจดอัตโนมัติ', { command: 'auto_record', on: true }],
    ['ปิดจดอัตโนมัติ', { command: 'auto_record', on: false }],
    ['ทดสอบแจ้งเตือน', { command: 'test_push' }],
  ])('%s', (text, expected) => {
    expect(parseMessage(text, TODAY)).toMatchObject({ kind: 'command', ...expected });
  });
});

describe('extra questions', () => {
  it.each([
    ['เมื่อวานใช้ไปเท่าไหร่', { query: 'yesterday_spent' }],
    ['เดือนที่แล้วใช้ไปเท่าไหร่', { query: 'last_month_summary' }],
    ['วันนี้จดอะไรไปบ้าง', { query: 'today_list' }],
    ['ค่าอาหารเดือนนี้เท่าไหร่', { query: 'category_spend', categoryId: 'food' }],
    ['เดือนนี้ค่าเดินทางเท่าไหร่', { query: 'category_spend', categoryId: 'transport' }],
  ])('%s', (text, expected) => {
    expect(parseMessage(text, TODAY)).toMatchObject({ kind: 'extra_query', ...expected });
  });

  it('existing questions keep working', () => {
    expect(parseMessage('เดือนนี้เหลือเงินเท่าไหร่', TODAY)).toMatchObject({ kind: 'query', intent: 'available' });
    expect(parseMessage('วันนี้ใช้ไปเท่าไหร่', TODAY)).toMatchObject({ kind: 'query', intent: 'today_spent' });
  });
});
