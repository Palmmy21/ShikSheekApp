import type { z } from 'zod';
import type { DatetimePickerAction, PostbackAction } from '../../../infrastructure/line/messages.ts';
import { ACTION_PARAMS, encodePostback, type ActionName } from '../postback.ts';

/** Typed postback action. Labels are capped at LINE's 20-char limit. */
export function pb<A extends ActionName>(
  label: string,
  action: A,
  params?: z.input<(typeof ACTION_PARAMS)[A]>,
  opts: { displayText?: string; inputOption?: PostbackAction['inputOption']; fillInText?: string } = {},
): PostbackAction {
  const a: PostbackAction = { type: 'postback', label: label.slice(0, 20), data: encodePostback(action, params) };
  if (opts.displayText) a.displayText = opts.displayText.slice(0, 300);
  if (opts.inputOption) a.inputOption = opts.inputOption;
  if (opts.fillInText) a.fillInText = opts.fillInText;
  return a;
}

export function datePicker<A extends ActionName>(
  label: string,
  action: A,
  params: z.input<(typeof ACTION_PARAMS)[A]>,
  initial: string,
  min: string,
  max: string,
): DatetimePickerAction {
  return { type: 'datetimepicker', label: label.slice(0, 20), data: encodePostback(action, params), mode: 'date', initial, min, max };
}
