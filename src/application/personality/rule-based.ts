/**
 * Rule-based personality: playful Thai friend, never a formal advisor.
 * Lines are chosen deterministically from a seed (e.g. a transaction id) so tests are stable and the
 * same event never flips text on re-render. The AI layer (Phase 8) may replace these lines, but only
 * the WORDS — numbers always come from the calculation engine.
 */

export type Situation =
  | 'saved_expense'
  | 'saved_expense_big'
  | 'saved_income'
  | 'saved_saving'
  | 'balance_healthy'
  | 'balance_tight'
  | 'balance_negative'
  | 'no_income_yet'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'bill_paid'
  | 'bill_reminder'
  | 'daily_none'
  | 'daily_spent'
  | 'spent_less_than_before'
  | 'spent_more_than_before'
  | 'goal_reached'
  | 'greeting'
  | 'thanks'
  | 'unknown'
  | 'cancelled';

const LINES: Record<Situation, string[]> = {
  saved_expense: [
    'จดให้แล้วจ้า ชิกชิกจำไว้ให้หมดเลย 🐔',
    'เรียบร้อย! จดทุกบาทแบบนี้ เดี๋ยวเงินก็อยู่หมัด',
    'โอเค บันทึกแล้ว~ ใช้เงินอย่างมีสติเหมือนเดิมน้า',
    'จดแล้ว! ขยันจดแบบนี้ ชิกชิกปลื้มมาก',
  ],
  saved_expense_big: [
    'โอ้โห ก้อนใหญ่เลยนะ! ชิกชิกแอบสะดุ้ง 😳',
    'จดแล้ว… แต่ก้อนนี้ใหญ่อยู่น้า ช่วงนี้ประหยัดหน่อยเนอะ',
    'ว้าว ใจป้ำมาก! บันทึกให้แล้ว ขอให้คุ้มค่านะ',
  ],
  saved_income: [
    'เย้! เงินเข้าแล้ว ชิกชิกขอเต้นหน่อย 🎉',
    'รวยแล้วว! อย่าลืมแบ่งเก็บก่อนใช้น้า',
    'เงินเข้าาา~ วันนี้เป็นวันดีของเรา 💰',
  ],
  saved_saving: [
    'เก่งมาก! เก็บเงินได้อีกก้อนแล้ว 🐷',
    'ออมแล้วจ้า เป้าหมายใกล้เข้ามาอีกนิด!',
    'ชิกชิกภูมิใจในตัวเธอสุดๆ เก็บต่อไปนะ',
  ],
  balance_healthy: [
    'การเงินดูดีมาก ชิกชิกยิ้มแก้มปริ ✨',
    'เดือนนี้คุมอยู่! ไปต่อแบบนี้เลย',
  ],
  balance_tight: [
    'เหลือไม่เยอะแล้วน้า ช่วงนี้ค่อยๆ ใช้นะ',
    'เริ่มตึงมือแล้ว ลองงดของไม่จำเป็นสักพักไหม?',
  ],
  balance_negative: [
    'ตอนนี้ติดลบแล้วน้า ไม่เป็นไร ค่อยๆ ประคองไปด้วยกัน',
    'ชิกชิกตกใจนิดนึง… แต่เราแก้ได้ เริ่มจากรายจ่ายเล็กๆ ก่อน',
  ],
  no_income_yet: [
    'ยังไม่มีรายรับเดือนนี้เลย จดเงินเดือนก่อนไหม จะได้รู้ว่าใช้ได้อีกเท่าไหร่',
    'พิมพ์ "ได้เงินเดือน 25000" เพื่อเริ่มต้นเดือนได้เลยน้า',
  ],
  budget_warning: [
    'งบหมวดนี้ใกล้หมดแล้วน้า เบรกนิดนึง~',
    'ระวังๆ งบเหลือน้อยแล้ว ชิกชิกเป็นห่วง',
  ],
  budget_exceeded: [
    'เกินงบแล้ววว! ชิกชิกโมโหนิดๆ นะ 😤',
    'ทะลุงบไปแล้ว พักหมวดนี้ไว้ก่อนดีไหม',
  ],
  bill_paid: ['จ่ายบิลเรียบร้อย ไม่มีค้าง สบายใจ ✅', 'เคลียร์แล้ว! ความรับผิดชอบระดับเทพ'],
  bill_reminder: ['อย่าลืมจ่ายน้า ไม่งั้นโดนค่าปรับ!', 'ชิกชิกมาเตือนแล้วนะ ใกล้ถึงกำหนดแล้ว'],
  daily_none: ['วันนี้ยังไม่ได้จดอะไรเลย ไม่ใช้เงินเลยเหรอ เก่งมาก! หรือลืมจด? 😆', 'วันนี้เงียบๆ ไม่มีรายจ่าย ดีงาม~'],
  daily_spent: ['สรุปวันนี้มาแล้ว พรุ่งนี้สู้ใหม่นะ', 'จบอีกวัน! ขอบคุณที่ขยันจดน้า'],
  spent_less_than_before: ['ใช้น้อยกว่าเมื่อก่อนด้วย! เยี่ยมไปเลย 👏', 'ประหยัดขึ้นนะเนี่ย ชิกชิกปลื้ม'],
  spent_more_than_before: ['ใช้มากกว่าเมื่อก่อนนิดนึงน้า ลองดูว่าหมวดไหนพุ่ง', 'รายจ่ายขยับขึ้นหน่อย ไม่เป็นไร ค่อยๆ ปรับ'],
  goal_reached: ['ถึงเป้าแล้ว!!! ฉลองงง 🎉🐔', 'ทำได้แล้ว! เป้าหมายสำเร็จ ภูมิใจสุดๆ'],
  greeting: ['หวัดดีจ้า! วันนี้มีอะไรให้ชิกชิกจดบ้าง? 🐔', 'ดีจ้า~ พิมพ์รายจ่ายมาได้เลย เช่น "กินข้าว 65"'],
  thanks: ['ยินดีจ้า ชิกชิกอยู่ตรงนี้เสมอ 💛', 'ด้วยความยินดี! จดต่อไปนะ'],
  unknown: [
    'ชิกชิกงงนิดนึง 🤔 ลองพิมพ์แบบ "กินข้าว 65" หรือ "ได้เงินเดือน 25000" ดูนะ',
    'ยังไม่เข้าใจเลย ลองพิมพ์ชื่อรายการตามด้วยจำนวนเงินดูน้า เช่น "กาแฟ 80"',
  ],
  cancelled: ['ยกเลิกให้แล้วจ้า', 'โอเค ไม่จดแล้ว~'],
};

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function line(situation: Situation, seed = ''): string {
  const options = LINES[situation];
  return options[hash(`${situation}:${seed}`) % options.length]!;
}

export const ALL_SITUATIONS = Object.keys(LINES) as Situation[];
