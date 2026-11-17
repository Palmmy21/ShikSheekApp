/**
 * Built-in categories. Ids are stable and stored in the database; labels/emoji are presentation.
 * `keywords` feed the rule-based Thai parser (longest match wins).
 */
import type { TransactionType } from './index.ts';

export interface Category {
  id: string;
  kind: Exclude<TransactionType, 'saving'> | 'saving';
  labelTh: string;
  emoji: string;
  keywords: string[];
}

export const CATEGORIES: readonly Category[] = [
  // ── expense ──
  {
    id: 'food', kind: 'expense', labelTh: 'อาหาร', emoji: '🍜',
    keywords: ['กินข้าว', 'ข้าว', 'อาหาร', 'ก๋วยเตี๋ยว', 'ข้าวมันไก่', 'กะเพรา', 'ส้มตำ', 'หมูกระทะ', 'ชาบู', 'บุฟเฟ่ต์', 'มื้อเที่ยง', 'มื้อเย็น', 'มื้อเช้า', 'ขนม', 'ของกิน', 'กาแฟ', 'ชานม', 'ชาไข่มุก', 'น้ำปั่น', 'เครื่องดื่ม', 'grab food', 'lineman', 'foodpanda', 'สตาร์บัค', 'อาหารเช้า', 'อาหารกลางวัน', 'อาหารเย็น', 'ข้าวเช้า', 'ข้าวเที่ยง', 'ข้าวเย็น', 'ผลไม้', 'เบเกอรี่', 'พิซซ่า', 'kfc', 'mk'],
  },
  {
    id: 'transport', kind: 'expense', labelTh: 'เดินทาง', emoji: '🚗',
    keywords: ['เติมน้ำมัน', 'น้ำมัน', 'แท็กซี่', 'taxi', 'grab', 'bolt', 'วิน', 'มอไซค์', 'bts', 'mrt', 'รถไฟฟ้า', 'รถเมล์', 'ทางด่วน', 'ค่าทางด่วน', 'ที่จอดรถ', 'ค่าจอดรถ', 'ค่ารถ', 'รถตู้', 'ตั๋วเครื่องบิน', 'ตั๋วรถไฟ', 'ชาร์จรถ', 'ล้างรถ'],
  },
  {
    id: 'shopping', kind: 'expense', labelTh: 'ช้อปปิ้ง', emoji: '🛍️',
    keywords: ['ช้อปปิ้ง', 'shopee', 'lazada', 'ซื้อของ', 'เสื้อ', 'กางเกง', 'รองเท้า', 'กระเป๋า', 'เครื่องสำอาง', 'สกินแคร์', 'ของใช้', 'ห้าง', 'เซเว่น', '7-11', 'lotus', 'โลตัส', 'big c', 'บิ๊กซี', 'tops', 'แม็คโคร', 'makro'],
  },
  {
    id: 'bills', kind: 'expense', labelTh: 'บิล/ค่าบริการ', emoji: '🧾',
    keywords: ['ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'อินเทอร์เน็ต', 'ค่าโทรศัพท์', 'ค่ามือถือ', 'netflix', 'spotify', 'youtube premium', 'icloud', 'ค่าเช่า', 'ค่าห้อง', 'ค่าบ้าน', 'ค่าคอนโด', 'ค่าส่วนกลาง', 'ผ่อน', 'ค่างวด', 'ประกัน', 'บัตรเครดิต'],
  },
  {
    id: 'health', kind: 'expense', labelTh: 'สุขภาพ', emoji: '💊',
    keywords: ['ยา', 'หาหมอ', 'โรงพยาบาล', 'คลินิก', 'ทำฟัน', 'หมอฟัน', 'วิตามิน', 'ฟิตเนส', 'ยิม', 'gym', 'นวด'],
  },
  {
    id: 'entertainment', kind: 'expense', labelTh: 'บันเทิง', emoji: '🎬',
    keywords: ['หนัง', 'ดูหนัง', 'คอนเสิร์ต', 'เกม', 'เที่ยว', 'ปาร์ตี้', 'เหล้า', 'เบียร์', 'บาร์', 'คาราโอเกะ', 'steam', 'ท่องเที่ยว', 'โรงแรม'],
  },
  {
    id: 'home', kind: 'expense', labelTh: 'บ้าน/ของใช้', emoji: '🏠',
    keywords: ['ของใช้ในบ้าน', 'เฟอร์นิเจอร์', 'ซ่อมบ้าน', 'ผงซักฟอก', 'ทิชชู่', 'ikea', 'อิเกีย', 'homepro', 'ซักผ้า'],
  },
  {
    id: 'education', kind: 'expense', labelTh: 'การศึกษา', emoji: '📚',
    keywords: ['หนังสือ', 'คอร์ส', 'เรียน', 'ค่าเทอม', 'ติว', 'udemy'],
  },
  {
    id: 'family', kind: 'expense', labelTh: 'ครอบครัว/ให้', emoji: '👨‍👩‍👧',
    keywords: ['ให้แม่', 'ให้พ่อ', 'ให้ที่บ้าน', 'ส่งเงินบ้าน', 'ทำบุญ', 'บริจาค', 'ของขวัญ', 'ซองงานแต่ง', 'ใส่ซอง', 'แฟน', 'ลูก'],
  },
  {
    id: 'pet', kind: 'expense', labelTh: 'สัตว์เลี้ยง', emoji: '🐶',
    keywords: ['อาหารแมว', 'อาหารหมา', 'ทรายแมว', 'สัตวแพทย์', 'หมาแมว'],
  },
  { id: 'other_expense', kind: 'expense', labelTh: 'อื่นๆ', emoji: '📦', keywords: [] },
  // ── income ──
  { id: 'salary', kind: 'income', labelTh: 'เงินเดือน', emoji: '💼', keywords: ['เงินเดือน', 'เงินเดือนออก', 'salary'] },
  { id: 'bonus', kind: 'income', labelTh: 'โบนัส', emoji: '🎉', keywords: ['โบนัส', 'bonus'] },
  { id: 'freelance', kind: 'income', labelTh: 'งานเสริม', emoji: '💻', keywords: ['ฟรีแลนซ์', 'freelance', 'งานเสริม', 'ค่าจ้าง', 'รับจ้าง', 'ขายของได้', 'ค่าคอม'] },
  { id: 'gift_income', kind: 'income', labelTh: 'ได้รับเงิน', emoji: '🎁', keywords: ['แม่ให้', 'พ่อให้', 'ได้ซอง', 'อั่งเปา', 'ได้รับเงิน'] },
  { id: 'investment', kind: 'income', labelTh: 'ลงทุน/ดอกเบี้ย', emoji: '📈', keywords: ['ปันผล', 'ดอกเบี้ย', 'กำไรหุ้น', 'คริปโต'] },
  { id: 'refund', kind: 'income', labelTh: 'เงินคืน', emoji: '↩️', keywords: ['เงินคืน', 'คืนเงิน', 'refund', 'cashback'] },
  { id: 'other_income', kind: 'income', labelTh: 'รายรับอื่นๆ', emoji: '💰', keywords: [] },
  // ── saving ──
  { id: 'savings', kind: 'saving', labelTh: 'เงินออม', emoji: '🐷', keywords: ['ออม', 'เก็บเงิน', 'ฝากเงิน'] },
] as const;

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return BY_ID.get(id) ?? BY_ID.get('other_expense')!;
}

export function isKnownCategory(id: string): boolean {
  return BY_ID.has(id);
}

export function categoriesOfKind(kind: Category['kind']): Category[] {
  return CATEGORIES.filter((c) => c.kind === kind);
}

export function defaultCategoryFor(kind: Category['kind']): string {
  return kind === 'income' ? 'other_income' : kind === 'saving' ? 'savings' : 'other_expense';
}
