/**
 * Edit instructions in loose Thai, e.g.
 *   "ค่าห้อง เปลี่ยน 2000 3000"      → set_amount  target=ค่าห้อง old=2000 new=3000
 *   "แก้ค่าเน็ตเป็น 599"             → set_amount  target=ค่าเน็ต new=599
 *   "ปรับค่าห้องจาก 2000 เป็น 3000"  → set_amount  old=2000 new=3000
 *   "ค่าเน็ตเปลี่ยนเป็นวันที่ 10"      → set_day     day=10
 *   "หยุดค่ายิม" / "เริ่มค่ายิมใหม่" / "ลบค่าเน็ต"
 *   "งบอาหารเปลี่ยนเป็น 5000"         → set_amount  scope=budget
 *   "เป้าญี่ปุ่นเดือนละ 5000"          → set_reserve scope=goal
 * Pure text → intent; which item the user means is decided later by the resolver (with questions
 * when unsure). Amounts must appear in the user's text — nothing is invented.
 */
import { isValidPositiveAmount, type Satang } from '../../domain/money.ts';
import { extractAmounts, removeSpans } from './normalize.ts';

export type EditScope = 'fixed_cost' | 'goal' | 'budget' | 'transaction' | null;

export type EditIntent =
  | { kind: 'edit'; action: 'set_amount'; target: string; newAmount: Satang; oldAmount: Satang | null; scope: EditScope }
  | { kind: 'edit'; action: 'set_reserve'; target: string; newAmount: Satang; scope: 'goal' }
  | { kind: 'edit'; action: 'set_day'; target: string; day: number; scope: 'fixed_cost' }
  | { kind: 'edit'; action: 'pause' | 'resume' | 'delete'; target: string; scope: EditScope };

const VERB = /(เปลี่ยน|แก้ไข|แก้|ปรับ|อัปเดต|อัพเดท|อัพเดต|update)/;
const FILLER = /(เป็น|จาก|ให้|ยอด|ราคา|จำนวน|เงิน|บาท|ทุกเดือน|ด้วย|หน่อย|นะ|ครับ|ค่ะ|คะ|จ้า|ที|เลย)/g;

function scopeOf(text: string): EditScope {
  if (/^งบ|งบประมาณ/.test(text)) return 'budget';
  if (/^เป้า|เป้าหมาย|เป้าออม/.test(text)) return 'goal';
  return null;
}

function cleanTarget(raw: string): string {
  return raw.replace(VERB, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
}

export function parseEdit(text: string): EditIntent | null {
  // pause / resume / delete by name (generic phrases like "ลบรายการล่าสุด" are handled earlier)
  let m = /^(หยุด|พัก)(จ่าย)?(ชั่วคราว)?\s*(.+?)(ชั่วคราว|ไว้ก่อน)?$/.exec(text);
  if (m && !/ข้อมูล/.test(m[4]!)) return { kind: 'edit', action: 'pause', target: cleanTarget(m[4]!), scope: 'fixed_cost' };
  m = /^(เริ่ม|เปิด)(จ่าย)?\s*(.+?)\s*(ใหม่|ต่อ|อีกครั้ง)$/.exec(text);
  if (m && !/จดอัตโนมัติ/.test(m[3]!)) return { kind: 'edit', action: 'resume', target: cleanTarget(m[3]!), scope: 'fixed_cost' };
  m = /^(ลบ|ยกเลิก)\s*(บิล|รายการ)?\s*(.+)$/.exec(text);
  if (m && !/^(ล่าสุด|เมื่อกี้|เมื่อกี๊|ข้อมูล|ทั้งหมด)/.test(m[3]!) && !extractAmounts(m[3]!).length) {
    const target = m[3]!;
    return { kind: 'edit', action: 'delete', target: cleanTarget(target), scope: scopeOf(target) };
  }

  const hasVerb = VERB.test(text);
  const amounts = extractAmounts(text).filter((a) => isValidPositiveAmount(a.satang));

  // due day change: "...วันที่ 10"
  const day = /วันที่\s*(\d{1,2})/.exec(text);
  if (hasVerb && day && amounts.length === 0) {
    const d = Number(day[1]);
    if (d >= 1 && d <= 31) {
      const target = cleanTarget(text.slice(0, day.index).replace(/(ทุก|ครบ|กำหนด|จ่าย)/g, ' '));
      if (target) return { kind: 'edit', action: 'set_day', target, day: d, scope: 'fixed_cost' };
    }
  }

  // goal monthly reserve: "เป้าญี่ปุ่น(เปลี่ยน)เดือนละ 5000"
  const reserve = /เดือนละ|ต่อเดือน/.exec(text);
  if (reserve && amounts.length === 1 && scopeOf(text) === 'goal') {
    const target = cleanTarget(removeSpans(text.slice(0, reserve.index), amounts));
    if (target) return { kind: 'edit', action: 'set_reserve', target, newAmount: amounts[0]!.satang, scope: 'goal' };
  }

  // amount change needs an explicit edit cue: a verb, "เป็น", or "จาก X เป็น Y"
  const cue = hasVerb || /เป็น\s*[\d฿]/.test(text);
  if (!cue || amounts.length === 0 || amounts.length > 2) return null;
  const newAmount = amounts[amounts.length - 1]!.satang;
  const oldAmount = amounts.length === 2 ? amounts[0]!.satang : null;
  const target = cleanTarget(removeSpans(text, amounts));
  if (!target) return null;
  return { kind: 'edit', action: 'set_amount', target, newAmount, oldAmount, scope: scopeOf(target) };
}
