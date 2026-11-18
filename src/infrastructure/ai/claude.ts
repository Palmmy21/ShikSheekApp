/**
 * Optional Claude layer. Two narrow jobs, both with short timeouts and no retries:
 *   1. interpret(): turn chat text the rule-based parser didn't understand into a structured PROPOSAL.
 *   2. phrase():    write one short, playful Thai line for a situation (no numbers).
 *
 * It never sees other users' data, never writes to the database and never computes money.
 * Every result is re-validated by application code; on any error/timeout/refusal the caller falls
 * back to the rule-based behaviour.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { CATEGORIES } from '../../domain/entities/categories.ts';

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];
const QUERY_INTENTS = [
  'today_spent', 'available', 'upcoming_bills', 'month_summary', 'week_summary', 'dashboard', 'budgets',
  'fixed_costs', 'goals', 'history', 'reports', 'settings', 'help',
] as const;

export const AiIntentSchema = z.object({
  kind: z.enum(['transaction', 'query', 'chitchat', 'unknown']),
  type: z.enum(['income', 'expense']).nullable(),
  /** The amount EXACTLY as written in the message (e.g. "1,250" or "80"); verified by code. */
  amount_text: z.string().nullable(),
  category_id: z.enum(CATEGORY_IDS).nullable(),
  note: z.string().nullable(),
  /** 0 = today, -1 = yesterday … (never future) */
  date_offset_days: z.number().int().nullable(),
  query: z.enum(QUERY_INTENTS).nullable(),
  /** chitchat only: a short friendly Thai reply without any numbers */
  reply: z.string().nullable(),
});
export type AiIntent = z.infer<typeof AiIntentSchema>;

export const DocRowSchema = z.object({
  type: z.enum(['income', 'expense']),
  /** Amount EXACTLY as printed (e.g. "1,250.00"); never computed or converted. */
  amount_text: z.string(),
  /** Gregorian YYYY-MM-DD (convert Buddhist-era years by subtracting 543), or null if unreadable. */
  date: z.string().nullable(),
  description: z.string(),
  category_id: z.enum(CATEGORY_IDS).nullable(),
  /** Bank transaction reference / slip ref number if printed, else null. */
  reference: z.string().nullable(),
});
export const DocExtractionSchema = z.object({
  kind: z.enum(['transfer_slip', 'receipt', 'statement', 'not_financial', 'unreadable']),
  rows: z.array(DocRowSchema),
});
export type DocRow = z.infer<typeof DocRowSchema>;
export type DocExtraction = z.infer<typeof DocExtractionSchema>;

export type DocMediaType = 'image/jpeg' | 'image/png' | 'application/pdf';

export interface AiClient {
  interpret(text: string): Promise<AiIntent | null>;
  phrase(situation: string, example: string): Promise<string | null>;
  /** Read a payment slip, receipt or statement. null on error/timeout/refusal. */
  extractDocument(bytes: Uint8Array, mediaType: DocMediaType): Promise<DocExtraction | null>;
}

const EXTRACT_SYSTEM = `You read Thai personal-finance documents sent to the ShikSheek LINE bot: bank/e-wallet transfer slips (K PLUS, SCB EASY, Krungthai NEXT, PromptPay, TrueMoney...), receipts, and bank statements.
Return every money movement you can read as a row:
- amount_text: copy the amount EXACTLY as printed (keep digits, comma and decimals; drop currency words). Never add, subtract, total, round or convert amounts. Do not include fees as separate rows unless printed as separate lines.
- type: "expense" for money paid/sent/withdrawn/debited, "income" for money received/deposited/credited. For a transfer slip assume the sender is the user (expense) unless the slip clearly shows the user receiving.
- date: the transaction date as YYYY-MM-DD in the Gregorian calendar. Thai dates often use Buddhist-era years (2569 or "69" = 2026): subtract 543. null if not printed.
- description: short Thai/English text: receiver or merchant name, or the statement description (no account numbers).
- reference: the transaction/reference number printed on a slip (e.g. "เลขที่รายการ"), else null.
- category_id: best matching category, or null.
kind: transfer_slip | receipt | statement | not_financial (no money movement) | unreadable.
For a receipt, return ONE row with the grand total actually paid. For a statement, one row per transaction line (ignore balance-only lines, opening/closing balances and totals).
Categories: ${CATEGORIES.map((c) => `${c.id}=${c.labelTh}`).join(', ')}.`;

/** Chunked base64 (works on Deno and Node without Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const INTERPRET_SYSTEM = `You classify one chat message sent to "ShikSheek", a Thai personal-finance LINE bot with a chicken mascot.
Return:
- kind "transaction" when the user reports money they spent or received. Set type, amount_text (copy the number exactly as typed, digits only plus optional comma/decimal; never calculate or convert), category_id (best match), note (a few words describing it), date_offset_days (0 today, negative for past days).
- kind "query" when they ask about their money; set query.
- kind "chitchat" for greetings or small talk; set reply: one short, warm, playful Thai sentence (like a friendly chicken buddy), no numbers, no financial advice.
- kind "unknown" otherwise.
If a message contains more than one amount, use kind "unknown". Set unused fields to null.
Categories: ${CATEGORIES.map((c) => `${c.id}=${c.labelTh}`).join(', ')}.`;

const PHRASE_SYSTEM = `You are ชิกชิก, the chicken mascot of the ShikSheek finance app: a playful, warm Thai friend, never a formal advisor.
Write ONE short Thai sentence (max 80 characters) for the situation given. Use casual Thai (จ้า, น้า, เนอะ). At most one emoji.
Never include any digits, amounts, dates or financial advice. Reply with the sentence only.`;

export function createClaudeAi(opts: { apiKey: string; model: string; timeoutMs?: number }): AiClient {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 8_000, maxRetries: 0 });

  return {
    async interpret(text) {
      try {
        const response = await client.beta.messages.parse({
          model: opts.model,
          max_tokens: 1_024,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(AiIntentSchema) },
          system: INTERPRET_SYSTEM,
          messages: [{ role: 'user', content: text.slice(0, 500) }],
        });
        if (response.stop_reason === 'refusal') return null;
        return response.parsed_output ?? null;
      } catch {
        return null;
      }
    },

    async extractDocument(bytes, mediaType) {
      try {
        const data = bytesToBase64(bytes);
        const source =
          mediaType === 'application/pdf'
            ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
            : ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } } as const);
        const response = await client.beta.messages.parse(
          {
            model: opts.model,
            max_tokens: 16_000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium', format: betaZodOutputFormat(DocExtractionSchema) },
            system: EXTRACT_SYSTEM,
            messages: [{ role: 'user', content: [source, { type: 'text', text: 'Extract the money movements from this document.' }] }],
          },
          { timeout: 90_000 },
        );
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
        return response.parsed_output ?? null;
      } catch {
        return null;
      }
    },

    async phrase(situation, example) {
      try {
        const response = await client.beta.messages.create({
          model: opts.model,
          max_tokens: 512,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: PHRASE_SYSTEM,
          messages: [{ role: 'user', content: `Situation: ${situation}\nExample of the tone: ${example}` }],
        });
        if (response.stop_reason === 'refusal') return null;
        const block = response.content.find((b) => b.type === 'text');
        return block && block.type === 'text' ? block.text.trim() : null;
      } catch {
        return null;
      }
    },
  };
}
