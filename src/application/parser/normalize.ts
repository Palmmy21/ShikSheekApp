/**
 * Text normalisation + amount extraction shared by all rule-based parsers.
 * Amount parsing is exact (string → satang), never via floats.
 */
import { parseBahtToSatang, type Satang } from '../../domain/money.ts';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

export function normalizeText(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  s = s.replace(/[​-‍﻿]/g, ''); // zero-width chars from Thai keyboards
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  พัน: 1_000,
  หมื่น: 10_000,
  แสน: 100_000,
  ล้าน: 1_000_000,
};

export interface AmountMatch {
  satang: Satang;
  start: number;
  end: number;
  raw: string;
}

// number (with optional thousands separators/decimals) + optional multiplier + optional currency word
// "-" is excluded on both sides so "7-11" is not read as two amounts and negatives are never accepted.
const AMOUNT_RE = /(?<![\d.,/:-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d/:-])\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(บาท|บ\.|฿|thb)?/gi;
const CURRENCY_PREFIX_RE = /฿\s*$/;

/**
 * Find money amounts in normalised text. Numbers that are clearly not money are skipped:
 * dates ("วันที่ 5", "18/11"), times ("7:30", "7 โมง"), counts ("3 วัน", "2 แก้ว"), relative days.
 */
export function extractAmounts(text: string): AmountMatch[] {
  const result: AmountMatch[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const start = m.index!;
    const raw = m[0];
    const before = text.slice(Math.max(0, start - 8), start);
    const after = text.slice(start + raw.length, start + raw.length + 8);
    if (/(วันที่|ที่|ทุก)\s*$/.test(before) && !m[4]) continue; // "วันที่ 5", "ทุก 3 วัน"
    if (/^\s*(วัน|เดือน|ปี|สัปดาห์|อาทิตย์|โมง|นาที|ชั่วโมง|ทุ่ม|คน|แก้ว|ชิ้น|อัน|ครั้ง|ขวด|จาน|ลิตร|กิโล|ตัว|ใบ|เล่ม|%)/.test(after) && !m[4] && !m[3]) continue;
    if (/^(ม\.?ค|ก\.?พ|มี\.?ค|เม\.?ย|พ\.?ค|มิ\.?ย|ก\.?ค|ส\.?ค|ก\.?ย|ต\.?ค|พ\.?ย|ธ\.?ค)/.test(after.trim()) && !m[4]) continue; // "18 พ.ย."
    const base = parseBahtToSatang(m[2] ? `${m[1]}.${m[2]}` : m[1]!);
    if (base === null) continue;
    const mult = m[3] ? MULTIPLIERS[m[3]] ?? MULTIPLIERS[m[3].toLowerCase()] ?? 1 : 1;
    const satang = base * mult;
    if (!Number.isSafeInteger(satang)) continue;
    const hasPrefix = CURRENCY_PREFIX_RE.test(text.slice(0, start));
    result.push({ satang, start: hasPrefix ? text.slice(0, start).search(CURRENCY_PREFIX_RE) : start, end: start + raw.length, raw });
  }
  return result;
}

/** Remove the given spans from the text and tidy whitespace. */
export function removeSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  let s = text;
  for (const sp of sorted) s = s.slice(0, sp.start) + ' ' + s.slice(sp.end);
  return s.replace(/\s+/g, ' ').trim();
}
