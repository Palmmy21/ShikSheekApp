import { describe, expect, it } from 'vitest';
import { parseEdit } from '../../src/application/parser/edit-parser.ts';
import { dice, nameScore, resolve } from '../../src/application/services/entity-resolver.ts';
import { normalizeText } from '../../src/application/parser/normalize.ts';

const p = (s: string) => parseEdit(normalizeText(s));

describe('parseEdit', () => {
  it.each([
    ['ค่าห้อง เปลี่ยน 2000 3000', { action: 'set_amount', target: 'ค่าห้อง', oldAmount: 200_000, newAmount: 300_000 }],
    ['แก้ค่าเน็ตเป็น 599', { action: 'set_amount', target: 'ค่าเน็ต', newAmount: 59_900, oldAmount: null }],
    ['ปรับค่าห้องจาก 2000 เป็น 3000', { action: 'set_amount', target: 'ค่าห้อง', oldAmount: 200_000, newAmount: 300_000 }],
    ['ค่าเน็ตเป็น 650', { action: 'set_amount', target: 'ค่าเน็ต', newAmount: 65_000 }],
    ['เปลี่ยน netflix 419', { action: 'set_amount', target: 'netflix', newAmount: 41_900 }],
    ['ค่าเน็ตเปลี่ยนเป็นวันที่ 10', { action: 'set_day', target: 'ค่าเน็ต', day: 10 }],
    ['หยุดค่ายิม', { action: 'pause', target: 'ค่ายิม' }],
    ['พักจ่าย netflix ไว้ก่อน', { action: 'pause', target: 'netflix' }],
    ['เริ่มค่ายิมใหม่', { action: 'resume', target: 'ค่ายิม' }],
    ['ลบค่าเน็ต', { action: 'delete', target: 'ค่าเน็ต' }],
    ['งบอาหารเปลี่ยนเป็น 5000', { action: 'set_amount', target: 'งบอาหาร', newAmount: 500_000, scope: 'budget' }],
    ['เป้าญี่ปุ่นเปลี่ยนเป็น 40000', { action: 'set_amount', target: 'เป้าญี่ปุ่น', newAmount: 4_000_000, scope: 'goal' }],
    ['เป้าญี่ปุ่นเดือนละ 5000', { action: 'set_reserve', target: 'เป้าญี่ปุ่น', newAmount: 500_000 }],
  ])('%s', (text, expected) => {
    expect(p(text)).toMatchObject({ kind: 'edit', ...expected });
  });

  it('ordinary entries are not edits', () => {
    for (const t of ['กินข้าว 65', 'ค่าห้อง 6500', 'ได้เงินเดือน 25000', 'ลบรายการล่าสุด', 'ลบข้อมูล', 'เปิดจดอัตโนมัติ']) expect(p(t), t).toBeNull();
  });
});

describe('entity resolver', () => {
  const fcs = [
    { kind: 'fixed_cost' as const, id: '1', name: 'ค่าห้อง', amountSatang: 200_000 },
    { kind: 'fixed_cost' as const, id: '2', name: 'ค่าเน็ต AIS', amountSatang: 59_900 },
    { kind: 'fixed_cost' as const, id: '3', name: 'Netflix', amountSatang: 41_900 },
    { kind: 'fixed_cost' as const, id: '4', name: 'ค่าน้ำ', amountSatang: 15_000 },
    { kind: 'fixed_cost' as const, id: '5', name: 'ค่าน้ำมัน', amountSatang: 300_000 },
  ];

  it('tolerates missing prefixes, partial names, case and small typos', () => {
    expect(resolve('ห้อง', fcs)).toMatchObject({ status: 'unique', match: { id: '1' } });
    expect(resolve('ค่าเน็ต', fcs)).toMatchObject({ status: 'unique', match: { id: '2' } });
    expect(resolve('netflix', fcs)).toMatchObject({ status: 'unique', match: { id: '3' } });
    expect(resolve('ค่าหอ้ง', fcs).status).not.toBe('none'); // typo still finds something to ask about
  });

  it('an exact name wins over a longer similar one (น้ำ → ค่าน้ำ, not ค่าน้ำมัน)', () => {
    expect(resolve('น้ำ', fcs)).toMatchObject({ status: 'unique', match: { id: '4' } });
  });

  it('asks when the user could mean several items', () => {
    const two = [
      { kind: 'fixed_cost' as const, id: 'a', name: 'ค่าเน็ตบ้าน' },
      { kind: 'fixed_cost' as const, id: 'b', name: 'ค่าเน็ตมือถือ' },
    ];
    const r = resolve('ค่าเน็ต', two);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.options.map((o) => o.id).sort()).toEqual(['a', 'b']);
  });

  it('returns none for unrelated text', () => {
    expect(resolve('ประกันรถ', fcs).status).toBe('none');
  });

  it('scores are sane', () => {
    expect(nameScore('ค่าห้อง', 'ค่าห้อง')).toBe(1);
    expect(dice('abcd', 'abcd')).toBe(1);
    expect(nameScore('xyz', 'ค่าห้อง')).toBeLessThan(0.3);
  });
});
