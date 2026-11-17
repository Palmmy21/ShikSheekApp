import { describe, expect, it } from 'vitest';
import { aiIntentToParseResult, createAiPersonality, isSafeChatLine } from '../../src/application/personality/ai-assist.ts';
import type { AiClient, AiIntent } from '../../src/infrastructure/ai/claude.ts';

const TODAY = '2026-11-18';
const base: AiIntent = { kind: 'transaction', type: 'expense', amount_text: '120', category_id: 'food', note: 'ข้าวผัด', date_offset_days: 0, query: null, reply: null };

describe('AI proposals are guarded', () => {
  it('accepts an amount that literally appears in the user text', () => {
    expect(aiIntentToParseResult(base, 'แวะร้านป้าข้าวผัดไป 120 อร่อยมาก', TODAY)).toMatchObject({ kind: 'transaction', amountSatang: 12_000, categoryId: 'food', categoryConfident: true });
  });

  it('rejects an amount the AI invented or changed', () => {
    expect(aiIntentToParseResult({ ...base, amount_text: '1200' }, 'ข้าวผัด 120', TODAY)).toEqual({ kind: 'unknown' });
    expect(aiIntentToParseResult({ ...base, amount_text: '120' }, 'ข้าวผัดอร่อยมาก', TODAY)).toEqual({ kind: 'unknown' });
    expect(aiIntentToParseResult({ ...base, amount_text: '-50' }, 'ข้าว -50', TODAY)).toEqual({ kind: 'unknown' });
  });

  it('rejects messages with several amounts', () => {
    expect(aiIntentToParseResult(base, 'ข้าว 120 น้ำ 20', TODAY)).toEqual({ kind: 'unknown' });
  });

  it('falls back to "other" when the AI category is wrong for the type, and never future-dates', () => {
    const r = aiIntentToParseResult({ ...base, category_id: 'salary', date_offset_days: 5 }, 'จ่ายไป 120', TODAY);
    expect(r).toMatchObject({ categoryId: 'other_expense', categoryConfident: false, txnDate: TODAY });
    expect(aiIntentToParseResult({ ...base, date_offset_days: -1 }, 'จ่ายไป 120', TODAY)).toMatchObject({ txnDate: '2026-11-17' });
  });

  it('maps queries and ignores incomplete transactions', () => {
    expect(aiIntentToParseResult({ ...base, kind: 'query', query: 'available' }, 'ตังค์เหลือเท่าไรอะ', TODAY)).toEqual({ kind: 'query', intent: 'available' });
    expect(aiIntentToParseResult({ ...base, type: null }, 'x 120', TODAY)).toEqual({ kind: 'unknown' });
  });
});

describe('AI personality guard', () => {
  it('rejects lines with digits, links or excessive length', () => {
    expect(isSafeChatLine('เก่งมากเลยจ้า 🐔')).toBe(true);
    expect(isSafeChatLine('เหลือ 500 บาทนะ')).toBe(false);
    expect(isSafeChatLine('เหลือ ๕๐๐ บาท')).toBe(false);
    expect(isSafeChatLine('ดูที่ https://x.y')).toBe(false);
    expect(isSafeChatLine('ก'.repeat(121))).toBe(false);
    expect(isSafeChatLine(null)).toBe(false);
  });

  it('falls back to rule-based lines when the AI fails or misbehaves', async () => {
    const make = (out: string | null): AiClient => ({ interpret: async () => null, phrase: async () => out });
    expect(await createAiPersonality(make('ปังมากจ้า')).comment('saved_income', 's')).toBe('ปังมากจ้า');
    const fallback = await createAiPersonality(make('ได้ 25000 แล้ว')).comment('saved_income', 's');
    expect(fallback).not.toContain('25000');
    expect((await createAiPersonality(make(null)).comment('greeting', 's')).length).toBeGreaterThan(0);
  });
});
