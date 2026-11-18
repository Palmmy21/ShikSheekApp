/**
 * Postback action catalogue. Every button in Flex Messages and the Rich Menu encodes one of
 * these actions; the router has a handler for each (enforced by type + test).
 *
 * Wire format: URL-encoded query string, e.g. "a=txn_confirm&id=<uuid>" (LINE limit: 300 chars).
 */
import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ACTION_PARAMS = {
  // Rich Menu (6 buttons)
  dashboard: z.object({}),
  add_expense: z.object({}),
  add_income: z.object({}),
  fixed_costs: z.object({}),
  budgets: z.object({}),
  reports: z.object({}),

  // transactions
  txn_confirm: z.object({ id: uuid }),
  txn_cancel: z.object({ id: uuid }),
  txn_pick_category: z.object({ id: uuid, c: z.string().min(1).max(40) }),
  txn_change_category: z.object({ id: uuid }),
  txn_pick_date: z.object({ id: uuid, d: date.optional() }), // d comes from datetimepicker params
  txn_set_date: z.object({ id: uuid, d: date }),
  txn_start_category: z.object({ t: z.enum(['expense', 'income']), c: z.string().min(1).max(40) }),
  txn_history: z.object({ p: z.coerce.number().int().min(0).max(50).default(0) }),
  txn_delete: z.object({ id: uuid }),
  txn_delete_confirm: z.object({ id: uuid }),
  txn_undo: z.object({ id: uuid }),
  txn_set_type: z.object({ id: uuid, t: z.enum(['expense', 'income']) }), // slip direction fix
  import_confirm: z.object({ id: uuid }), // statement import draft
  multi_confirm: z.object({ id: uuid }), // several items from one message
  multi_undo: z.object({ id: uuid }), // undo a batch saved by auto-record (holder id)
  auto_record_toggle: z.object({ on: z.enum(['1', '0']) }),

  // fixed costs
  fc_add: z.object({}),
  fc_detail: z.object({ id: uuid }),
  fc_pay: z.object({ id: uuid }), // occurrence id → shows confirm
  fc_pay_confirm: z.object({ id: uuid }),
  fc_pay_custom: z.object({ id: uuid }), // paid a different amount → ask for it
  fc_create_confirm: z.object({ id: uuid }), // pending draft id
  fc_skip: z.object({ id: uuid }),
  fc_pause: z.object({ id: uuid }),
  fc_resume: z.object({ id: uuid }),
  fc_delete: z.object({ id: uuid }),
  fc_delete_confirm: z.object({ id: uuid }),
  fc_bills: z.object({}), // upcoming bills list

  // budgets & savings
  budget_add: z.object({}),
  budget_pick_category: z.object({ c: z.string().min(1).max(40) }),
  budget_delete: z.object({ id: uuid }),
  goals: z.object({}),
  goal_add: z.object({}),
  goal_create_confirm: z.object({ id: uuid }), // pending draft id
  goal_contribute: z.object({ id: uuid }),
  goal_archive: z.object({ id: uuid }),

  // reports
  report_daily: z.object({ d: date.optional() }),
  report_weekly: z.object({}),
  report_monthly: z.object({ k: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  report_categories: z.object({}),

  // onboarding & settings
  onboard_start: z.object({}),
  onboard_cycle: z.object({ day: z.coerce.number().int().min(1).max(28) }),
  onboard_skip_income: z.object({}),
  settings: z.object({}),
  settings_toggle: z.object({ k: z.enum(['dailySummary', 'weeklySummary', 'monthlySummary', 'billReminders', 'budgetAlerts']) }),
  settings_cycle: z.object({}),
  data_export: z.object({}),
  data_delete: z.object({}),
  data_delete_confirm: z.object({}),
  help: z.object({}),
  cancel_flow: z.object({}),
  draft_cancel: z.object({ id: uuid }), // cancel any pending draft (fixed cost / goal)
} as const;

export type ActionName = keyof typeof ACTION_PARAMS;
export type ActionParams<A extends ActionName> = z.infer<(typeof ACTION_PARAMS)[A]>;
export type ParsedAction = { [A in ActionName]: { action: A; params: ActionParams<A> } }[ActionName];

export const ACTION_NAMES = Object.keys(ACTION_PARAMS) as ActionName[];

export const RICH_MENU_ACTIONS = ['dashboard', 'add_expense', 'add_income', 'fixed_costs', 'budgets', 'reports'] as const satisfies readonly ActionName[];

export function encodePostback<A extends ActionName>(action: A, params?: z.input<(typeof ACTION_PARAMS)[A]>): string {
  const qs = new URLSearchParams({ a: action });
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const data = qs.toString();
  if (data.length > 300) throw new RangeError(`Postback data too long for ${action}`);
  return data;
}

/**
 * Decode postback data. `extra` carries datetimepicker params (e.g. { date: '2026-11-18' }).
 * Returns null for unknown actions or invalid params (stale/forged buttons).
 */
export function decodePostback(data: string, extra?: Record<string, string>): ParsedAction | null {
  let qs: URLSearchParams;
  try {
    qs = new URLSearchParams(data);
  } catch {
    return null;
  }
  const action = qs.get('a');
  if (!action || !(action in ACTION_PARAMS)) return null;
  const raw: Record<string, string> = {};
  for (const [k, v] of qs) if (k !== 'a') raw[k] = v;
  if (extra?.date) raw.d = extra.date;
  const schema = ACTION_PARAMS[action as ActionName];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  return { action, params: parsed.data } as ParsedAction;
}
