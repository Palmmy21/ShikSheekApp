/**
 * Guards around the optional AI layer.
 *  - AI proposals are converted into the SAME ParseResult the rule-based parser produces, so they go
 *    through the normal validate → confirmation card → user tap flow. Nothing is saved directly.
 *  - An AI-proposed amount is accepted only if that exact amount is present in the user's own text
 *    (the AI can locate a number, never invent or change one).
 *  - AI personality lines are rejected if they contain digits or are too long, then fall back.
 */
import { addDays, type LocalDate } from '../../domain/dates.ts';
import { getCategory, isKnownCategory } from '../../domain/entities/categories.ts';
import { isValidPositiveAmount, parseBahtToSatang } from '../../domain/money.ts';
import type { AiClient, AiIntent } from '../../infrastructure/ai/claude.ts';
import type { ParseResult } from '../parser/intent-parser.ts';
import type { EditIntent } from '../parser/edit-parser.ts';
import { extractAmounts, normalizeText } from '../parser/normalize.ts';
import type { PersonalityService } from './personality-service.ts';
import { line, type Situation } from './rule-based.ts';

export function aiIntentToParseResult(intent: AiIntent, originalText: string, today: LocalDate): ParseResult {
  if (intent.kind === 'query' && intent.query) return { kind: 'query', intent: intent.query };
  if (intent.kind !== 'transaction' || !intent.type || !intent.amount_text) return { kind: 'unknown' };

  const satang = parseBahtToSatang(intent.amount_text.replace(/\s/g, ''));
  if (satang === null || !isValidPositiveAmount(satang)) return { kind: 'unknown' };
  const present = extractAmounts(normalizeText(originalText)).map((a) => a.satang);
  if (present.length !== 1 || present[0] !== satang) return { kind: 'unknown' }; // AI may not invent amounts

  const categoryOk = !!intent.category_id && isKnownCategory(intent.category_id) && getCategory(intent.category_id).kind === intent.type;
  const offset = intent.date_offset_days ?? 0;
  const txnDate = offset <= 0 && offset >= -31 ? addDays(today, offset) : today;
  return {
    kind: 'transaction',
    type: intent.type,
    amountSatang: satang,
    categoryId: categoryOk ? intent.category_id! : intent.type === 'income' ? 'other_income' : 'other_expense',
    categoryConfident: categoryOk,
    note: intent.note?.slice(0, 100) || null,
    txnDate,
    dateIsFuture: false,
  };
}

export function isSafeChatLine(text: string | null | undefined): text is string {
  return !!text && text.length <= 120 && !/[0-9๐-๙]/.test(text) && !/https?:/i.test(text);
}

const SITUATION_HINT: Record<Situation, string> = {
  saved_expense: 'the user just recorded a small expense',
  saved_expense_big: 'the user just recorded a large expense',
  saved_income: 'the user just received income',
  saved_saving: 'the user just put money into savings',
  balance_healthy: 'the user has plenty left to spend this month',
  balance_tight: 'the user has little left to spend this month',
  balance_negative: 'the user has overspent this month (negative balance)',
  no_income_yet: 'the user has not recorded any income this month',
  budget_warning: 'a category budget is nearly used up',
  budget_exceeded: 'a category budget was exceeded',
  bill_paid: 'the user just paid a recurring bill',
  bill_reminder: 'a bill is due soon',
  daily_none: 'no spending recorded today',
  daily_spent: 'end-of-day summary',
  spent_less_than_before: 'the user spent less than the previous period',
  spent_more_than_before: 'the user spent more than the previous period',
  goal_reached: 'the user reached a savings goal',
  greeting: 'the user said hello',
  thanks: 'the user said thank you',
  unknown: 'the bot did not understand the message; suggest typing like "กินข้าว" followed by an amount',
  cancelled: 'the user cancelled an entry',
};

/** AI-written lines with rule-based fallback. Only enable when latency is acceptable (AI_PERSONALITY=true). */
export function createAiPersonality(ai: AiClient): PersonalityService {
  return {
    async comment(situation, seed = '') {
      const fallback = line(situation, seed);
      // the "unknown" line must keep its concrete example with digits → always rule-based
      if (situation === 'unknown') return fallback;
      const text = await ai.phrase(SITUATION_HINT[situation], fallback);
      return isSafeChatLine(text) ? text : fallback;
    },
  };
}

/**
 * AI "edit" proposal → EditIntent. The AI only names the item and copies numbers; numbers must
 * appear verbatim in the user's text and the item is resolved (or asked about) by the app.
 */
export function aiEditToIntent(intent: AiIntent, originalText: string): EditIntent | null {
  if (intent.kind !== 'edit' || !intent.edit_action || !intent.target_name?.trim()) return null;
  const target = intent.target_name.trim().slice(0, 60);
  const scope = intent.edit_scope ?? null;
  const present = extractAmounts(normalizeText(originalText)).map((a) => a.satang);
  const verified = (t: string | null) => {
    if (!t) return null;
    const v = parseBahtToSatang(t.replace(/[\s,฿]|บาท/g, ''));
    return v !== null && isValidPositiveAmount(v) && present.includes(v) ? v : null;
  };
  switch (intent.edit_action) {
    case 'set_amount': {
      const newAmount = verified(intent.new_amount_text);
      if (newAmount === null) return null;
      return { kind: 'edit', action: 'set_amount', target, newAmount, oldAmount: verified(intent.old_amount_text), scope };
    }
    case 'set_reserve': {
      const newAmount = verified(intent.new_amount_text);
      return newAmount === null ? null : { kind: 'edit', action: 'set_reserve', target, newAmount, scope: 'goal' };
    }
    case 'set_day': {
      const d = intent.day_of_month;
      return d && d >= 1 && d <= 31 && normalizeText(originalText).includes(String(d)) ? { kind: 'edit', action: 'set_day', target, day: d, scope: 'fixed_cost' } : null;
    }
    default:
      return { kind: 'edit', action: intent.edit_action, target, scope };
  }
}
