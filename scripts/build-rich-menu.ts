/**
 * Render the Rich Menu images (2500x1686) — one per plan variant — from TILES/BAR + mascot PNGs +
 * the bundled Prompt font.
 *   node scripts/build-rich-menu.ts
 * Output: assets/rich-menu/rich-menu-<variant>.jpg (LINE requires < 1 MB) + PNG previews.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '../src/presentation/line/flex/theme.ts';
import { BAR, BAR_HEIGHT, RICH_MENU_SIZE, RICH_MENU_VARIANTS, TILES, type RichMenuTile, type RichMenuVariant } from '../src/presentation/line/rich-menu/definition.ts';

const ROOT = join(import.meta.dirname, '..');
const FONT_BOLD = join(ROOT, 'assets/fonts/Prompt-Bold.ttf');
const FONT_SEMI = join(ROOT, 'assets/fonts/Prompt-SemiBold.ttf');
const OUT_DIR = join(ROOT, 'assets/rich-menu');

const GUTTER = 20;
const RADIUS = 48;
const VIOLET = '#6B4FD8';

const THEMES: Record<RichMenuTile['theme'], { bg: string; label: string; sub: string; blob: string }> = {
  red: { bg: BRAND.red, label: BRAND.white, sub: BRAND.yellow, blob: '#F25A5A' },
  deepRed: { bg: BRAND.deepRed, label: BRAND.white, sub: BRAND.yellow, blob: '#C93A41' },
  yellow: { bg: BRAND.yellow, label: BRAND.brown, sub: BRAND.deepRed, blob: '#FFE07A' },
  white: { bg: BRAND.white, label: BRAND.brown, sub: BRAND.red, blob: '#FFF1D6' },
};

const BAR_TONES = {
  cream: { bg: BRAND.white, kicker: BRAND.muted, plan: BRAND.brown, ctaBg: BRAND.red, ctaFg: BRAND.white, ring: '#F1E4CF' },
  violet: { bg: '#EFEAFF', kicker: '#7B68C9', plan: '#3B2A8C', ctaBg: VIOLET, ctaFg: BRAND.white, ring: '#DCD3FF' },
  red: { bg: '#FFECEA', kicker: BRAND.deepRed, plan: BRAND.brown, ctaBg: BRAND.white, ctaFg: BRAND.red, ring: '#F7CFCB' },
} as const;

async function textImage(text: string, fontfile: string, sizePx: number, color: string, letterSpacing = 0) {
  const spacing = letterSpacing ? ` letter_spacing="${letterSpacing * 1024}"` : '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return sharp({ text: { text: `<span foreground="${color}"${spacing}>${escaped}</span>`, font: `Prompt ${sizePx}px`, fontfile, rgba: true, dpi: 72 } })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function mascotImage(name: string, size: number) {
  return sharp(join(ROOT, 'assets/mascot', `${name}.png`)).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
}

async function barLayers(v: RichMenuVariant): Promise<OverlayOptions[]> {
  const b = BAR[v];
  const t = BAR_TONES[b.tone];
  const w = RICH_MENU_SIZE.width - GUTTER * 2;
  const h = BAR_HEIGHT - GUTTER * 1.5;
  const card = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${RADIUS}" ry="${RADIUS}" fill="${t.bg}" stroke="${t.ring}" stroke-width="4"/>
    </svg>`,
  );
  const mSize = Math.round(h * 0.92);
  const mascot = await mascotImage(b.mascot, mSize);
  const kicker = await textImage(b.kicker, FONT_SEMI, 52, t.kicker);
  const plan = await textImage(b.plan, FONT_BOLD, 104, t.plan);
  const cta = await textImage(b.cta, FONT_BOLD, 76, t.ctaFg);
  const ctaW = cta.info.width + 120;
  const ctaH = 150;
  const pill = Buffer.from(
    `<svg width="${ctaW}" height="${ctaH}" xmlns="http://www.w3.org/2000/svg"><rect width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${t.ctaBg}"/></svg>`,
  );
  const left = GUTTER;
  const top = GUTTER;
  const textX = left + 40 + mSize + 30;
  const GAP = 14;
  const blockH = kicker.info.height + GAP + plan.info.height;
  const textTop = top + (h - blockH) / 2;
  const pillX = left + w - ctaW - 50;
  const pillY = top + (h - ctaH) / 2;
  return [
    { input: card, left, top },
    { input: mascot, left: left + 40, top: Math.round(top + (h - mSize) / 2) },
    { input: kicker.data, left: Math.round(textX), top: Math.round(textTop) },
    { input: plan.data, left: Math.round(textX), top: Math.round(textTop + kicker.info.height + GAP) },
    { input: pill, left: Math.round(pillX), top: Math.round(pillY) },
    { input: cta.data, left: Math.round(pillX + (ctaW - cta.info.width) / 2), top: Math.round(pillY + (ctaH - cta.info.height) / 2) },
  ];
}

async function tileLayers(t: RichMenuTile, i: number): Promise<OverlayOptions[]> {
  const cols = 4;
  const areaTop = BAR_HEIGHT;
  const w = Math.floor((RICH_MENU_SIZE.width - GUTTER * (cols + 1)) / cols);
  const h = Math.floor((RICH_MENU_SIZE.height - areaTop - GUTTER * 2.5) / 2);
  const left = GUTTER + (i % cols) * (w + GUTTER);
  const top = areaTop + GUTTER * 0.5 + Math.floor(i / cols) * (h + GUTTER);
  const theme = THEMES[t.theme];

  const card = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="c"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath></defs>
      <g clip-path="url(#c)">
        <rect width="${w}" height="${h}" fill="${theme.bg}"/>
        <circle cx="${w / 2}" cy="${h * 0.36}" r="${h * 0.28}" fill="${theme.blob}"/>
        <circle cx="${w * 0.92}" cy="${h * 0.06}" r="${h * 0.11}" fill="${theme.blob}" opacity="0.7"/>
      </g>
      ${t.theme === 'white' ? `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#F1E4CF" stroke-width="4"/>` : ''}
    </svg>`,
  );
  const mascotSize = Math.round(h * 0.58);
  const mascot = await mascotImage(t.mascot, mascotSize);
  const labelSize = t.labelTh.length > 8 ? 70 : 84;
  const label = await textImage(t.labelTh, FONT_BOLD, labelSize, theme.label);
  const sub = await textImage(t.labelEn, FONT_SEMI, 32, theme.sub, 4);
  return [
    { input: card, left, top },
    { input: mascot, left: Math.round(left + (w - mascotSize) / 2), top: Math.round(top + h * 0.06) },
    // align label bottoms (Thai upper vowels/tones make heights differ)
    { input: label.data, left: Math.round(left + (w - label.info.width) / 2), top: Math.round(top + h * 0.82 - label.info.height) },
    { input: sub.data, left: Math.round(left + (w - sub.info.width) / 2), top: Math.round(top + h * 0.82 + 8) },
  ];
}

mkdirSync(OUT_DIR, { recursive: true });
const tiles = (await Promise.all(TILES.map((t, i) => tileLayers(t, i)))).flat();
for (const v of RICH_MENU_VARIANTS) {
  const layers = [...(await barLayers(v)), ...tiles];
  const png = await sharp({ create: { width: RICH_MENU_SIZE.width, height: RICH_MENU_SIZE.height, channels: 3, background: BRAND.cream } }).composite(layers).png().toBuffer();
  await sharp(png).png().toFile(join(OUT_DIR, `rich-menu-${v}-preview.png`));
  const file = join(OUT_DIR, `rich-menu-${v}.jpg`);
  await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toFile(file);
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`✓ assets/rich-menu/rich-menu-${v}.jpg (${kb} KB)`);
  if (kb >= 1024) throw new Error('Rich menu image must be under 1 MB');
}
