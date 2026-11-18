/**
 * Provider-independent AI contract: output schemas, prompts and the AiClient interface.
 * Every provider (Anthropic direct, OpenRouter) uses the SAME prompts and schemas, and every result
 * is re-validated with these Zod schemas plus the application guards before it is used.
 */
import * as z from 'zod/v4';
import { CATEGORIES } from '../../domain/entities/categories.ts';

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];
const QUERY_INTENTS = [
  'today_spent', 'available', 'upcoming_bills', 'month_summary', 'week_summary', 'dashboard', 'budgets',
  'fixed_costs', 'goals', 'history', 'reports', 'settings', 'help',
] as const;

export const AiIntentSchema = z.object({
  kind: z.enum(['transaction', 'query', 'chitchat', 'edit', 'unknown']),
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
  /** edit only */
  edit_action: z.enum(['set_amount', 'set_day', 'set_reserve', 'pause', 'resume', 'delete']).nullable(),
  edit_scope: z.enum(['fixed_cost', 'goal', 'budget', 'transaction']).nullable(),
  target_name: z.string().nullable(),
  new_amount_text: z.string().nullable(),
  old_amount_text: z.string().nullable(),
  day_of_month: z.number().int().nullable(),
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
  /**  lists the user's own item names (bills, goals, budgets) so edits can refer to them. */
  interpret(text: string, context?: string): Promise<AiIntent | null>;
  phrase(situation: string, example: string): Promise<string | null>;
  /** Read a payment slip, receipt or statement. null on error/timeout/refusal. */
  extractDocument(bytes: Uint8Array, mediaType: DocMediaType): Promise<DocExtraction | null>;
}

export const EXTRACT_SYSTEM = `You read Thai personal-finance documents sent to the ShikSheek LINE bot: bank/e-wallet transfer slips (K PLUS, SCB EASY, Krungthai NEXT, PromptPay, TrueMoney...), receipts, and bank statements.
Return every money movement you can read as a row:
- amount_text: copy the amount EXACTLY as printed (keep digits, comma and decimals; drop currency words). Never add, subtract, total, round or convert amounts. Do not include fees as separate rows unless printed as separate lines.
- type: "expense" for money paid/sent/withdrawn/debited, "income" for money received/deposited/credited. For a transfer slip assume the sender is the user (expense) unless the slip clearly shows the user receiving.
- date: the transaction date as YYYY-MM-DD in the Gregorian calendar. Thai dates often use Buddhist-era years (2569 or "69" = 2026): subtract 543. null if not printed.
- description: short Thai/English text: receiver or merchant name, or the statement description (no account numbers).
- reference: the transaction/reference number printed on a slip (e.g. "เลขที่รายการ"), else null.
- category_id: best matching category, or null.
kind: transfer_slip | receipt | statement | not_financial (no money movement) | unreadable.
For a receipt (ใบเสร็จ / ใบกำกับภาษี / POS slip from 7-Eleven, Lotus's, Makro, cafes, restaurants, e-commerce...), return ONE expense row: amount = the grand total actually paid after discounts and VAT (labels like "รวมทั้งสิ้น", "ยอดชำระ", "Total", "Grand Total", "Net"), never a subtotal or a single item; description = the store/merchant name; category_id = from what was bought (groceries/snacks/meals → food, fuel → transport, medicine → health ...); reference = the receipt / tax-invoice number if printed. For a statement, one row per transaction line (ignore balance-only lines, opening/closing balances and totals).
Categories: ${CATEGORIES.map((c) => `${c.id}=${c.labelTh}`).join(', ')}.`;

/** Chunked base64 (works on Deno and Node without Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export const INTERPRET_SYSTEM = `You classify one chat message sent to "ShikSheek", a Thai personal-finance LINE bot with a chicken mascot.
Return:
- kind "transaction" when the user reports money they spent or received. Set type, amount_text (copy the number exactly as typed, digits only plus optional comma/decimal; never calculate or convert), category_id (best match), note (a few words describing it), date_offset_days (0 today, negative for past days).
- kind "query" when they ask about their money; set query.
- kind "chitchat" for greetings or small talk; set reply: one short, warm, playful Thai sentence (like a friendly chicken buddy), no numbers, no financial advice.
- kind "edit" when the user wants to change, pause, resume or delete one of THEIR existing items (a recurring bill, a budget, a savings goal, or a recent entry). Set edit_action (set_amount, set_day for a new due day of the month, set_reserve for a goal's monthly saving, pause, resume, delete), edit_scope, target_name (use the exact name from "Known items" when one fits, otherwise copy what they typed), new_amount_text / old_amount_text copied exactly as typed, day_of_month. If you are unsure which item they mean, still return your best target_name — the app will ask them.
- kind "unknown" otherwise.
If a message contains more than one amount, use kind "unknown". Set unused fields to null.
Categories: ${CATEGORIES.map((c) => `${c.id}=${c.labelTh}`).join(', ')}.`;

export const PHRASE_SYSTEM = `You are ชิกชิก, the chicken mascot of the ShikSheek finance app: a playful, warm Thai friend, never a formal advisor.
Write ONE short Thai sentence (max 80 characters) for the situation given. Use casual Thai (จ้า, น้า, เนอะ). At most one emoji.
Never include any digits, amounts, dates or financial advice. Reply with the sentence only.`;
