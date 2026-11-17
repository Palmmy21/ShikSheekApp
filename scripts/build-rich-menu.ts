/**
 * Render the Rich Menu image (2500x1686) from TILES + mascot PNGs + bundled Prompt font.
 *   node scripts/build-rich-menu.ts
 * Output: assets/rich-menu/rich-menu.jpg (LINE requires < 1 MB) and a PNG preview.
 */
import sharp, { type OverlayOptions } from 'sharp';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '../src/presentation/line/flex/theme.ts';
import { RICH_MENU_SIZE, TILES, tileBounds, type RichMenuTile } from '../src/presentation/line/rich-menu/definition.ts';

const ROOT = join(import.meta.dirname, '..');
const FONT_BOLD = join(ROOT, 'assets/fonts/Prompt-Bold.ttf');
const FONT_SEMI = join(ROOT, 'assets/fonts/Prompt-SemiBold.ttf');
const OUT_DIR = join(ROOT, 'assets/rich-menu');

const GUTTER = 22;
const RADIUS = 56;

const THEMES: Record<RichMenuTile['theme'], { bg: string; label: string; sub: string; blob: string }> = {
  red: { bg: BRAND.red, label: BRAND.white, sub: BRAND.yellow, blob: '#F25A5A' },
  deepRed: { bg: BRAND.deepRed, label: BRAND.white, sub: BRAND.yellow, blob: '#C93A41' },
  yellow: { bg: BRAND.yellow, label: BRAND.brown, sub: BRAND.deepRed, blob: '#FFE07A' },
  white: { bg: BRAND.white, label: BRAND.brown, sub: BRAND.red, blob: '#FFF1D6' },
};

async function textImage(text: string, fontfile: string, sizePx: number, color: string, letterSpacing = 0) {
  const spacing = letterSpacing ? ` letter_spacing="${letterSpacing * 1024}"` : '';
  return sharp({
    text: {
      text: `<span foreground="${color}"${spacing}>${text}</span>`,
      font: `Prompt ${sizePx}px`,
      fontfile,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function tileLayers(t: RichMenuTile, i: number) {
  // Even visual grid; tap areas (tileBounds) are the exact thirds/halves LINE expects.
  void tileBounds;
  const w = Math.floor((RICH_MENU_SIZE.width - GUTTER * 4) / 3);
  const h = Math.floor((RICH_MENU_SIZE.height - GUTTER * 3) / 2);
  const left = GUTTER + (i % 3) * (w + GUTTER);
  const top = GUTTER + Math.floor(i / 3) * (h + GUTTER);
  const theme = THEMES[t.theme];

  const card = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="c"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath></defs>
      <g clip-path="url(#c)">
        <rect width="${w}" height="${h}" fill="${theme.bg}"/>
        <circle cx="${w / 2}" cy="${h * 0.33}" r="${h * 0.27}" fill="${theme.blob}"/>
        <circle cx="${w * 0.9}" cy="${h * 0.08}" r="${h * 0.12}" fill="${theme.blob}" opacity="0.7"/>
      </g>
      ${t.theme === 'white' ? `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="#F1E4CF" stroke-width="4"/>` : ''}
    </svg>`,
  );

  const mascotSize = Math.round(h * 0.54);
  const mascot = await sharp(join(ROOT, 'assets/mascot', `${t.mascot}.png`)).resize(mascotSize, mascotSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

  const labelSize = t.labelTh.length > 9 ? 88 : 104;
  const label = await textImage(t.labelTh, FONT_BOLD, labelSize, theme.label);
  const sub = await textImage(t.labelEn, FONT_SEMI, 38, theme.sub, 4);

  const layers: OverlayOptions[] = [
    { input: card, left: Math.round(left), top: Math.round(top) },
    { input: mascot, left: Math.round(left + (w - mascotSize) / 2), top: Math.round(top + h * 0.06) },
    { input: label.data, left: Math.round(left + (w - label.info.width) / 2), top: Math.round(top + h * 0.63) },
    { input: sub.data, left: Math.round(left + (w - sub.info.width) / 2), top: Math.round(top + h * 0.63 + label.info.height + 18) },
  ];
  return layers;
}

mkdirSync(OUT_DIR, { recursive: true });
const layers = (await Promise.all(TILES.map((t, i) => tileLayers(t, i)))).flat();
const base = sharp({ create: { width: RICH_MENU_SIZE.width, height: RICH_MENU_SIZE.height, channels: 3, background: BRAND.cream } }).composite(layers);
const png = await base.png().toBuffer();
await sharp(png).png().toFile(join(OUT_DIR, 'rich-menu-preview.png'));
await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(join(OUT_DIR, 'rich-menu.jpg'));
const kb = Math.round(statSync(join(OUT_DIR, 'rich-menu.jpg')).size / 1024);
console.log(`✓ assets/rich-menu/rich-menu.jpg (${kb} KB)`);
if (kb >= 1024) throw new Error('Rich menu image must be under 1 MB');
