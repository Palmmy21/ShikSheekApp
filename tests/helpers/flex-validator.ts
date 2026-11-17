/**
 * Offline structural checks against LINE Messaging API limits. Complements the online
 * `scripts/validate-flex.ts` (LINE's /v2/bot/message/validate/reply endpoint).
 */
import type { Message } from '../../src/infrastructure/line/messages.ts';

const SIZES = new Set(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl', 'full']);
const SPACING = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl']);
const BUBBLE_SIZES = new Set(['nano', 'micro', 'deca', 'hecto', 'kilo', 'mega', 'giga']);
const COMPONENT_TYPES = new Set(['box', 'text', 'image', 'button', 'separator', 'filler', 'icon', 'span', 'video']);
const PX_OR_PCT = /^(\d+(\.\d+)?(px|%))$/;

function checkAction(action: Record<string, unknown>, path: string, errors: string[], labelMax: number) {
  if (!action || typeof action !== 'object') return errors.push(`${path}: missing action`);
  const label = action.label as string | undefined;
  if (label !== undefined && (label.length === 0 || label.length > labelMax)) errors.push(`${path}: label length ${label.length} > ${labelMax}`);
  if (action.type === 'postback') {
    const data = action.data as string;
    if (!data || data.length > 300) errors.push(`${path}: postback data length ${data?.length}`);
    if (action.displayText !== undefined && (action.displayText as string).length > 300) errors.push(`${path}: displayText too long`);
  } else if (action.type === 'uri') {
    if (!/^(https:|line:|tel:)/.test(action.uri as string)) errors.push(`${path}: uri must be https/line/tel`);
  } else if (action.type === 'datetimepicker') {
    if (!action.data) errors.push(`${path}: datetimepicker needs data`);
  } else if (action.type !== 'message') {
    errors.push(`${path}: unknown action type ${String(action.type)}`);
  }
}

function walk(node: Record<string, unknown>, path: string, errors: string[]) {
  const type = node.type as string;
  if (!COMPONENT_TYPES.has(type)) errors.push(`${path}: unknown component type ${type}`);
  if (node.size !== undefined && type !== 'image' && type !== 'icon' && !SIZES.has(node.size as string) && !PX_OR_PCT.test(node.size as string)) {
    errors.push(`${path}: invalid size ${String(node.size)}`);
  }
  if (type === 'image' || type === 'icon') {
    if (!/^https:\/\//.test(node.url as string)) errors.push(`${path}: image url must be https`);
    if ((node.url as string).length > 2000) errors.push(`${path}: image url too long`);
  }
  if (type === 'text' && (typeof node.text !== 'string' || node.text.length === 0)) errors.push(`${path}: empty text`);
  if (type === 'button') checkAction(node.action as Record<string, unknown>, `${path}.action`, errors, 40);
  if (node.action && type !== 'button') checkAction(node.action as Record<string, unknown>, `${path}.action`, errors, 40);
  if (node.spacing !== undefined && !SPACING.has(node.spacing as string) && !PX_OR_PCT.test(node.spacing as string)) errors.push(`${path}: invalid spacing`);
  for (const key of ['width', 'height', 'paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd', 'cornerRadius']) {
    const v = node[key];
    if (v !== undefined && !PX_OR_PCT.test(v as string) && !SPACING.has(v as string)) errors.push(`${path}: invalid ${key} ${String(v)}`);
  }
  if (type === 'box') {
    if (!['vertical', 'horizontal', 'baseline'].includes(node.layout as string)) errors.push(`${path}: invalid layout`);
    const contents = node.contents as Record<string, unknown>[];
    if (!Array.isArray(contents)) errors.push(`${path}: box contents must be an array`);
    else contents.forEach((c, i) => walk(c, `${path}.contents[${i}]`, errors));
  }
}

export function validateMessages(messages: Message[]): string[] {
  const errors: string[] = [];
  if (messages.length > 5) errors.push(`too many messages: ${messages.length}`);
  messages.forEach((m, mi) => {
    const p = `msg[${mi}]`;
    const qr = (m as { quickReply?: { items: Array<{ action: Record<string, unknown> }> } }).quickReply;
    if (qr) {
      if (qr.items.length === 0 || qr.items.length > 13) errors.push(`${p}: quick reply items ${qr.items.length}`);
      qr.items.forEach((it, i) => checkAction(it.action, `${p}.quickReply[${i}]`, errors, 20));
    }
    if (m.type === 'text') {
      if (!m.text || m.text.length > 5000) errors.push(`${p}: text length ${m.text.length}`);
    } else if (m.type === 'flex') {
      if (!m.altText || m.altText.length > 1500) errors.push(`${p}: altText length`);
      const size = new TextEncoder().encode(JSON.stringify(m.contents)).length;
      if (size > 30_000) errors.push(`${p}: flex JSON ${size} bytes > 30KB`);
      const bubbles = m.contents.type === 'carousel' ? m.contents.contents : [m.contents];
      if (m.contents.type === 'carousel' && bubbles.length > 12) errors.push(`${p}: carousel > 12`);
      bubbles.forEach((b, bi) => {
        if (b.type !== 'bubble') errors.push(`${p}: expected bubble`);
        if (b.size && !BUBBLE_SIZES.has(b.size)) errors.push(`${p}: bubble size`);
        for (const part of ['header', 'hero', 'body', 'footer'] as const) {
          const node = b[part];
          if (node) walk(node as Record<string, unknown>, `${p}.bubble[${bi}].${part}`, errors);
        }
      });
    }
  });
  return errors;
}
