/**
 * Static overflow check for Flex templates: estimates each button / single-line text width from the
 * bubble size and box layout, and flags labels LINE would cut off ("แพ็กเกจข…").
 * Calibrated against the LINE Flex Simulator (kilo bubble, two buttons side by side ≈ 9 Thai glyphs).
 *   node scripts/check-flex-overflow.ts      (exit code 1 when something overflows)
 */
import { buildSamples } from './lib/flex-samples.ts';

type Node = Record<string, any>;
const BUBBLE_W: Record<string, number> = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 500 };
const SPACING: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const px = (v: unknown, fallback = 0) => (typeof v === 'string' && v.endsWith('px') ? Number(v.slice(0, -2)) : typeof v === 'string' && v in SPACING ? SPACING[v]! : fallback);

/** Thai combining marks take no horizontal space. */
const COMBINING = /[ัิ-ฺ็-๎️‍]/u;
export function textWidth(s: string, fontPx = 14): number {
  let w = 0;
  for (const ch of s) {
    if (COMBINING.test(ch)) continue;
    if (/\p{Extended_Pictographic}/u.test(ch)) w += fontPx * 1.3;
    else if (ch === ' ') w += fontPx * 0.3;
    else if (/[฀-๿]/.test(ch)) w += fontPx * 0.72;
    else w += fontPx * 0.62;
  }
  return w;
}
const FONT: Record<string, number> = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29 };

export const problems: string[] = [];

function walk(n: Node, width: number, path: string): void {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'button') {
    const label = String(n.action?.label ?? '');
    const need = textWidth(label, 15) + 24;
    if (need > width) problems.push(`${path}: button "${label}" needs ~${Math.round(need)}px, has ~${Math.round(width)}px`);
    return;
  }
  if (n.type === 'text') {
    const single = n.wrap === false || n.maxLines === 1;
    if (single && n.maxLines !== 1 && n.wrap !== false) { // single-line notes end with an intentional ellipsis
      const need = textWidth(String(n.text ?? ''), FONT[n.size ?? 'md'] ?? 14);
      if (need > width + 2) problems.push(`${path}: single-line text "${String(n.text).slice(0, 30)}" is cut (${Math.round(need)} > ${Math.round(width)}px)`);
    }
    return;
  }
  if (n.type !== 'box') return;
  if (n.flex === 0) return; // content-sized (pills, icons)
  const pad = px(n.paddingAll) * 2 || px(n.paddingStart) + px(n.paddingEnd);
  const inner = width - (n.paddingStart || n.paddingEnd ? px(n.paddingStart ?? n.paddingAll) + px(n.paddingEnd ?? n.paddingAll) : pad);
  const kids: Node[] = n.contents ?? [];
  if (n.layout === 'horizontal' || n.layout === 'baseline') {
    const gap = SPACING[n.spacing ?? 'none'] ?? 0;
    const fixed = kids.filter((k) => k.flex === 0);
    const fixedW = fixed.reduce((s, k) => s + (k.type === 'image' ? px(k.size, 60) : k.type === 'text' ? textWidth(String(k.text ?? ''), FONT[k.size ?? 'md'] ?? 14) : 0), 0);
    const flexKids = kids.filter((k) => k.flex !== 0);
    const total = flexKids.reduce((s, k) => s + (typeof k.flex === 'number' ? k.flex : 1), 0) || 1;
    const avail = inner - fixedW - gap * Math.max(0, kids.length - 1);
    kids.forEach((k, i) => walk(k, k.flex === 0 ? fixedW : (avail * (typeof k.flex === 'number' ? k.flex : 1)) / total, `${path}/${i}`));
  } else {
    kids.forEach((k, i) => walk(k, inner, `${path}/${i}`));
  }
}

function checkBubble(b: Node, name: string): void {
  const w = BUBBLE_W[b.size ?? 'mega'] ?? 300;
  for (const part of ['header', 'hero', 'body', 'footer']) if (b[part]) walk(b[part], w, `${name}.${part}`);
}

export function checkAll(): string[] {
  problems.length = 0;
  const samples = buildSamples();
  for (const [name, msgs] of Object.entries(samples)) {
    msgs.forEach((m: Node, i: number) => {
      if (m.type !== 'flex') return;
      const c = m.contents;
      if (c.type === 'carousel') c.contents.forEach((b: Node, j: number) => checkBubble(b, `${name}[${i}]#${j}`));
      else checkBubble(c, `${name}[${i}]`);
    });
  }
  return [...problems];
}

if (process.argv[1]?.endsWith('check-flex-overflow.ts')) {
  const found = checkAll();
  console.log(found.length ? found.join('\n') : '✓ no overflowing labels');
  if (found.length) process.exitCode = 1;
}
