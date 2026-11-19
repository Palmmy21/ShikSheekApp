import type { z } from 'zod';
import type { DatetimePickerAction, PostbackAction } from '../../../infrastructure/line/messages.ts';
import { ACTION_PARAMS, encodePostback, type ActionName } from '../postback.ts';

/** Cut to max characters by code point (never splits an emoji into a broken half). */
export function clipLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length <= max ? label : chars.slice(0, max).join('').trimEnd();
}

/** Typed postback action. Button labels may be up to 40 chars; quickReply() trims to 20. */
export function pb<A extends ActionName>(
  label: string,
  action: A,
  params?: z.input<(typeof ACTION_PARAMS)[A]>,
  opts: { displayText?: string; inputOption?: PostbackAction['inputOption']; fillInText?: string } = {},
): PostbackAction {
  const a: PostbackAction = { type: 'postback', label: clipLabel(label, 40), data: encodePostback(action, params) };
  if (opts.displayText) a.displayText = clipLabel(opts.displayText, 300);
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
  return { type: 'datetimepicker', label: clipLabel(label, 40), data: encodePostback(action, params), mode: 'date', initial, min, max };
}
