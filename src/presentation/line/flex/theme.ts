/**
 * ShikSheek brand tokens + small Flex builders so templates stay readable and consistent.
 */
import type { Action, FlexBubble, FlexComponent } from '../../../infrastructure/line/messages.ts';

export const BRAND = {
  red: '#E93636',
  deepRed: '#B9232B',
  yellow: '#FFD447',
  cream: '#FFF8E9',
  brown: '#392B27',
  white: '#FFFFFF',
  muted: '#8A7B74',
  line: '#F1E4CF',
  track: '#F3E6D3',
  green: '#2E9E6A',
  softRed: '#FDE3E1',
  softYellow: '#FFF1BF',
} as const;

type Props = Record<string, unknown>;

export const txt = (text: string, props: Props = {}): FlexComponent => ({
  type: 'text',
  text: text.length ? text : ' ',
  wrap: true,
  color: BRAND.brown,
  size: 'sm',
  ...props,
});

export const box = (layout: 'vertical' | 'horizontal' | 'baseline', contents: FlexComponent[], props: Props = {}): FlexComponent => ({
  type: 'box',
  layout,
  contents,
  ...props,
});

export const vbox = (contents: FlexComponent[], props: Props = {}) => box('vertical', contents, props);
export const hbox = (contents: FlexComponent[], props: Props = {}) => box('horizontal', contents, props);

export const img = (url: string, props: Props = {}): FlexComponent => ({
  type: 'image',
  url,
  aspectMode: 'fit',
  aspectRatio: '1:1',
  ...props,
});

export const sep = (props: Props = {}): FlexComponent => ({ type: 'separator', color: BRAND.line, ...props });
export const filler = (): FlexComponent => ({ type: 'filler' });

export const button = (action: Action, style: 'primary' | 'secondary' | 'link' = 'primary', props: Props = {}): FlexComponent => ({
  type: 'button',
  action,
  style,
  height: 'sm',
  ...(style === 'primary' ? { color: BRAND.red } : style === 'secondary' ? { color: BRAND.softYellow } : { color: BRAND.deepRed }),
  ...props,
});

/** Label on the left, value on the right. */
export const row = (label: string, value: string, props: { valueColor?: string; bold?: boolean; size?: string } = {}): FlexComponent =>
  hbox([
    txt(label, { color: BRAND.muted, size: props.size ?? 'sm', flex: 5 }),
    txt(value, { align: 'end', color: props.valueColor ?? BRAND.brown, weight: props.bold ? 'bold' : 'regular', size: props.size ?? 'sm', flex: 5 }),
  ]);

/** Rounded progress bar; `basisPoints` may exceed 10000 (bar is capped, colour signals overflow). */
export const progressBar = (basisPoints: number, color: string): FlexComponent => {
  const pct = Math.max(0, Math.min(100, Math.floor(basisPoints / 100)));
  return vbox(
    [pct > 0 ? vbox([filler()], { width: `${pct}%`, height: '8px', backgroundColor: color, cornerRadius: '4px' }) : filler()],
    { height: '8px', backgroundColor: BRAND.track, cornerRadius: '4px' },
  );
};

export const pill = (text: string, bg: string, color: string): FlexComponent =>
  vbox([txt(text, { size: 'xxs', color, weight: 'bold', align: 'center', wrap: false })], {
    backgroundColor: bg,
    cornerRadius: '10px',
    paddingStart: '8px',
    paddingEnd: '8px',
    paddingTop: '2px',
    paddingBottom: '2px',
    flex: 0,
  });

/** White rounded card on the cream body. */
export const card = (contents: FlexComponent[], props: Props = {}): FlexComponent =>
  vbox(contents, { backgroundColor: BRAND.white, cornerRadius: '16px', paddingAll: '14px', spacing: 'sm', ...props });

/** Brand header: kicker + title on red, mascot on the right. */
export const header = (kicker: string, title: string, mascotUrl: string, opts: { subtitle?: string; bg?: string } = {}): FlexComponent =>
  hbox(
    [
      vbox(
        [
          txt(kicker, { size: 'xxs', color: BRAND.yellow, weight: 'bold' }),
          txt(title, { size: 'lg', color: BRAND.white, weight: 'bold' }),
          ...(opts.subtitle ? [txt(opts.subtitle, { size: 'xs', color: '#FFE3E1' })] : []),
        ],
        { flex: 7, justifyContent: 'center', spacing: 'xs' },
      ),
      img(mascotUrl, { size: '72px', flex: 0 }),
    ],
    { backgroundColor: opts.bg ?? BRAND.red, paddingAll: '16px', paddingEnd: '12px', spacing: 'md' },
  );

export function bubble(parts: { header?: FlexComponent; body: FlexComponent[]; footer?: FlexComponent[]; size?: FlexBubble['size'] }): FlexBubble {
  const b: FlexBubble = {
    type: 'bubble',
    size: parts.size ?? 'mega',
    body: vbox(parts.body, { backgroundColor: BRAND.cream, paddingAll: '16px', spacing: 'md' }),
  };
  if (parts.header) b.header = parts.header;
  if (parts.footer && parts.footer.length) {
    b.footer = vbox(parts.footer, { backgroundColor: BRAND.cream, paddingAll: '12px', paddingTop: '0px', spacing: 'sm' });
  }
  b.styles = { header: { separator: false }, footer: { separator: false } };
  return b;
}
