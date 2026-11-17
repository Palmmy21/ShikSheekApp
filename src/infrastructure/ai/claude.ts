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

export interface AiClient {
  interpret(text: string): Promise<AiIntent | null>;
  phrase(situation: string, example: string): Promise<string | null>;
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
