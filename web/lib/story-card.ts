'use client';
/**
 * Draws a 1080×1920 (9:16) story card on a canvas, entirely in the browser — no upload, no server
 * rendering. All copy comes from the API (`GET /story`); this file only lays it out.
 *
 * Instagram covers roughly the top and bottom 220px with its own UI, so the persona, numbers and
 * badge sit inside that safe zone; only decoration and the small invite line live near the edges.
 */
import type { StoryCard, StoryDeck, StoryTheme, StoryValue } from './liff-api';

export const STORY_W = 1080;
export const STORY_H = 1920;
const PAD = 96;

interface Palette {
  bg: [string, string];
  fg: string;
  sub: string;
  glow: string;
  heroBg: string;
  heroLabel: string;
  heroFg: string;
  tile: string;
  tileFg: string;
  badgeBg: string;
  badgeFg: string;
  spark: string;
}

const PALETTES: Record<StoryTheme, Palette> = {
  gold: { bg: ['#FFE27A', '#FFAE1F'], fg: '#392B27', sub: 'rgba(57,43,39,0.72)', glow: 'rgba(255,255,255,0.65)', heroBg: '#FFFFFF', heroLabel: '#75645D', heroFg: '#E93636', tile: 'rgba(255,255,255,0.55)', tileFg: '#392B27', badgeBg: '#E93636', badgeFg: '#FFFFFF', spark: '#FFFFFF' },
  green: { bg: ['#3FD08A', '#0F6E45'], fg: '#FFFFFF', sub: 'rgba(255,255,255,0.86)', glow: 'rgba(255,255,255,0.28)', heroBg: '#FFFFFF', heroLabel: '#5C7A6B', heroFg: '#11744A', tile: 'rgba(255,255,255,0.16)', tileFg: '#FFFFFF', badgeBg: '#FFD447', badgeFg: '#392B27', spark: '#FFE58A' },
  red: { bg: ['#FF6E5E', '#B9232B'], fg: '#FFFFFF', sub: 'rgba(255,255,255,0.86)', glow: 'rgba(255,212,71,0.35)', heroBg: '#FFFFFF', heroLabel: '#75645D', heroFg: '#E93636', tile: 'rgba(255,255,255,0.16)', tileFg: '#FFFFFF', badgeBg: '#FFD447', badgeFg: '#392B27', spark: '#FFD447' },
  cream: { bg: ['#FFF8E9', '#FFDDA8'], fg: '#392B27', sub: 'rgba(57,43,39,0.7)', glow: 'rgba(255,212,71,0.5)', heroBg: '#FFFFFF', heroLabel: '#75645D', heroFg: '#E93636', tile: 'rgba(255,255,255,0.75)', tileFg: '#392B27', badgeBg: '#E93636', badgeFg: '#FFFFFF', spark: '#E93636' },
  night: { bg: ['#3D2660', '#130A21'], fg: '#FFFFFF', sub: 'rgba(255,255,255,0.78)', glow: 'rgba(255,212,71,0.3)', heroBg: 'rgba(255,255,255,0.1)', heroLabel: 'rgba(255,255,255,0.75)', heroFg: '#FFD447', tile: 'rgba(255,255,255,0.1)', tileFg: '#FFFFFF', badgeBg: '#FFD447', badgeFg: '#392B27', spark: '#FFD447' },
};

/** What a private value shows when "ซ่อนยอดเงิน" is on. */
export function maskValue(v: StoryValue, hide: boolean): string {
  if (!hide || !v.private) return v.value;
  return v.value.startsWith('฿') ? '฿ ••••••' : 'ความลับ 🤫';
}

let fontFamily: string | null = null;
/** next/font hashes the family name; read it from the CSS variable and wait until Thai glyphs load. */
async function ensureFonts(): Promise<string> {
  if (fontFamily) return fontFamily;
  const css = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  const family = css || "'Prompt', system-ui, sans-serif";
  try {
    await Promise.all(['500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 64px ${family}`, 'ชิกชิกไก่ทองคำ฿0123456789%')));
    await document.fonts.ready;
  } catch {
    /* fall back to whatever is available */
  }
  fontFamily = family;
  return family;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, family: string, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${family}`;
}

/** Thai has no spaces between words: break on word segments when the browser supports it. */
function segments(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg('th', { granularity: 'word' }).segment(text), (s) => s.segment);
  return Array.from(text);
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const seg of segments(text)) {
    const next = line + seg;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line.trimEnd());
      line = seg.trimStart();
    } else line = next;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

/** Largest font size (≤ max) at which `text` fits in `maxLines` lines. */
function fit(ctx: Ctx, family: string, weight: number, text: string, maxWidth: number, max: number, min: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = max; size > min; size -= 4) {
    setFont(ctx, family, weight, size);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  setFont(ctx, family, weight, min);
  const lines = wrap(ctx, text, maxWidth);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/.$/u, '')}…`;
  }
  return { size: min, lines };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Small deterministic PRNG so a card looks the same every time it is drawn. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = color;
  ctx.fill();
}

function background(ctx: Ctx, p: Palette, seed: number) {
  const g = ctx.createLinearGradient(0, 0, STORY_W * 0.4, STORY_H);
  g.addColorStop(0, p.bg[0]);
  g.addColorStop(1, p.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  // soft blobs
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(STORY_W + 60, 260, 360, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-120, STORY_H - 420, 420, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // sparkles + confetti, kept away from the text column's middle
  const r = rng(seed);
  for (let i = 0; i < 16; i++) {
    const x = r() < 0.5 ? 40 + r() * 200 : STORY_W - 240 + r() * 200;
    const y = 300 + r() * (STORY_H - 700);
    ctx.globalAlpha = 0.35 + r() * 0.5;
    if (i % 3 === 0) sparkle(ctx, x, y, 14 + r() * 22, p.spark);
    else {
      ctx.beginPath();
      ctx.arc(x, y, 5 + r() * 8, 0, Math.PI * 2);
      ctx.fillStyle = p.spark;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export interface RenderOptions {
  hideAmounts: boolean;
}

/** Render one card. Returns a canvas at full story resolution. */
export async function renderStoryCard(deck: StoryDeck, card: StoryCard, opts: RenderOptions): Promise<HTMLCanvasElement> {
  const family = await ensureFonts();
  const [mascot, logo] = await Promise.all([loadImage(`/mascot/${card.mascot}.png`), loadImage('/favicon.png')]);
  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d')!;
  const p = PALETTES[card.theme] ?? PALETTES.cream;
  const inner = STORY_W - PAD * 2;
  ctx.textBaseline = 'alphabetic';

  background(ctx, p, card.kind.length * 7919 + card.title.length * 104729);

  // ── brand row ──
  let y = 150;
  if (logo) ctx.drawImage(logo, PAD, y - 54, 72, 72);
  setFont(ctx, family, 700, 40);
  ctx.fillStyle = p.fg;
  ctx.textAlign = 'left';
  ctx.fillText('ShikSheek ชิกชิก', PAD + (logo ? 90 : 0), y);
  if (deck.planBadge) {
    setFont(ctx, family, 800, 34);
    const w = ctx.measureText(deck.planBadge).width + 56;
    const bg = deck.planBadge === 'PRO' ? '#6B4FD8' : '#E93636';
    roundRect(ctx, STORY_W - PAD - w, y - 48, w, 64, 32, bg);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(deck.planBadge, STORY_W - PAD - w / 2, y - 4);
  }

  // ── eyebrow ──
  y = 280;
  ctx.textAlign = 'center';
  ctx.fillStyle = p.sub;
  const eyebrow = fit(ctx, family, 500, card.eyebrow, inner, 42, 30, 1);
  setFont(ctx, family, 500, eyebrow.size);
  ctx.fillText(eyebrow.lines[0] ?? '', STORY_W / 2, y);

  // ── measure the text stack first, then give the mascot whatever room is left ──
  const title = fit(ctx, family, 800, card.title, inner, 132, 76, 2);
  const sub = fit(ctx, family, 500, card.subtitle, inner - 40, 46, 34, 2);
  const heroH = 230;
  const stats = card.stats.slice(0, 3);
  const below =
    30 + title.lines.length * title.size * 1.05 + 18 + sub.lines.length * sub.size * 1.35 + 44 + heroH + (card.badge ? 30 + 88 : 0) + (stats.length ? 30 + 160 : 0);
  const CONTENT_BOTTOM = 1690;
  const top = 310;
  const mSize = Math.max(240, Math.min(480, CONTENT_BOTTOM - top - below));
  const mTop = top + Math.max(0, CONTENT_BOTTOM - top - below - mSize) / 2;

  // ── mascot with glow ──
  const glow = ctx.createRadialGradient(STORY_W / 2, mTop + mSize / 2, 40, STORY_W / 2, mTop + mSize / 2, mSize * 0.62);
  glow.addColorStop(0, p.glow);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, mTop - 80, STORY_W, mSize + 160);
  if (mascot) ctx.drawImage(mascot, (STORY_W - mSize) / 2, mTop, mSize, mSize);

  // ── title + subtitle ──
  y = mTop + mSize + 30;
  ctx.fillStyle = p.fg;
  setFont(ctx, family, 800, title.size);
  for (const line of title.lines) {
    y += title.size * 1.05;
    ctx.fillText(line, STORY_W / 2, y);
  }
  ctx.fillStyle = p.sub;
  setFont(ctx, family, 500, sub.size);
  y += 18;
  for (const line of sub.lines) {
    y += sub.size * 1.35;
    ctx.fillText(line, STORY_W / 2, y);
  }

  // ── hero number ──
  y += 44;
  roundRect(ctx, PAD, y, inner, heroH, 48, p.heroBg);
  ctx.fillStyle = p.heroLabel;
  setFont(ctx, family, 500, 38);
  ctx.fillText(card.hero.label, STORY_W / 2, y + 70);
  ctx.fillStyle = p.heroFg;
  const heroText = maskValue(card.hero, opts.hideAmounts);
  const hero = fit(ctx, family, 800, heroText, inner - 80, 116, 60, 1);
  setFont(ctx, family, 800, hero.size);
  ctx.fillText(hero.lines[0] ?? '', STORY_W / 2, y + 100 + hero.size * 0.8);
  y += heroH;

  // ── bragging badge ──
  if (card.badge) {
    y += 30;
    const b = fit(ctx, family, 700, `🏅 ${card.badge}`, inner - 80, 40, 30, 1);
    setFont(ctx, family, 700, b.size);
    const w = Math.min(inner, ctx.measureText(b.lines[0]!).width + 80);
    roundRect(ctx, (STORY_W - w) / 2, y, w, 88, 44, p.badgeBg);
    ctx.fillStyle = p.badgeFg;
    ctx.fillText(b.lines[0]!, STORY_W / 2, y + 58);
    y += 88;
  }

  // ── stats tiles ──
  if (stats.length) {
    y += 30;
    const gap = 24;
    const tileW = (inner - gap * (stats.length - 1)) / stats.length;
    const tileH = 160;
    stats.forEach((s, i) => {
      const x = PAD + i * (tileW + gap);
      roundRect(ctx, x, y, tileW, tileH, 36, p.tile);
      ctx.fillStyle = p.sub;
      const l = fit(ctx, family, 500, s.label, tileW - 32, 32, 24, 1);
      setFont(ctx, family, 500, l.size);
      ctx.fillText(l.lines[0]!, x + tileW / 2, y + 60);
      ctx.fillStyle = p.tileFg;
      const v = fit(ctx, family, 700, maskValue(s, opts.hideAmounts), tileW - 32, 50, 28, 1);
      setFont(ctx, family, 700, v.size);
      ctx.fillText(v.lines[0]!, x + tileW / 2, y + 128);
    });
  }

  // ── footer: invite (the growth loop) ──
  ctx.fillStyle = p.fg;
  const inv = fit(ctx, family, 600, deck.invite.line, inner, 36, 26, 1);
  setFont(ctx, family, 600, inv.size);
  ctx.fillText(inv.lines[0]!, STORY_W / 2, STORY_H - 196);
  ctx.fillStyle = p.sub;
  setFont(ctx, family, 500, 28);
  ctx.fillText('ผู้ช่วยการเงินบน LINE · จดง่าย มีเงินเหลือเก็บ', STORY_W / 2, STORY_H - 146);

  return canvas;
}

export function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('render failed'))), 'image/png');
  });
}

/** Can this browser hand an image file to the OS share sheet (→ Instagram Stories)? */
export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
