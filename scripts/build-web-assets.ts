/**
 * Social share image (1200x630) and favicons for the landing page.
 *   node scripts/build-web-assets.ts
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { BRAND } from '../src/presentation/line/flex/theme.ts';

const ROOT = join(import.meta.dirname, '..');
const PUB = join(ROOT, 'web/public');
const BOLD = join(ROOT, 'assets/fonts/Prompt-Bold.ttf');
const SEMI = join(ROOT, 'assets/fonts/Prompt-SemiBold.ttf');

const text = (markup: string, fontfile: string, px: number) =>
  sharp({ text: { text: markup, font: `Prompt ${px}px`, fontfile, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });

const bg = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${BRAND.cream}"/>
  <circle cx="930" cy="330" r="270" fill="${BRAND.yellow}"/>
  <rect x="0" y="560" width="1200" height="70" fill="${BRAND.red}"/>
</svg>`);
const mascot = await sharp(join(ROOT, 'assets/mascot/encouraging.png')).resize(440, 440).toBuffer();
const word = await text(`<span foreground="${BRAND.red}">Shik</span><span foreground="${BRAND.deepRed}">Sheek</span>`, BOLD, 64);
const head1 = await text(`<span foreground="${BRAND.brown}">ให้เรื่องเงิน</span>`, BOLD, 82);
const head2 = await text(`<span foreground="${BRAND.brown}">เป็นเรื่อง</span><span foreground="${BRAND.red}">ชิกชิก!</span>`, BOLD, 82);
const sub = await text(`<span foreground="#6B5A53">ผู้ช่วยการเงินบน LINE · จดด้วยภาษาพูด · รู้ยอดใช้ได้จริง</span>`, SEMI, 27);
const band = await text(`<span foreground="#FFFFFF">กินข้าว 65   ·   ได้เงินเดือน 25000   ·   พรุ่งนี้มีค่าอะไรต้องจ่ายบ้าง</span>`, SEMI, 28);

await sharp(bg)
  .composite([
    { input: mascot, left: 735, top: 95 },
    { input: word.data, left: 72, top: 70 },
    { input: head1.data, left: 72, top: 170 },
    { input: head2.data, left: 72, top: 170 + head1.info.height + 4 },
    { input: sub.data, left: 74, top: 430 },
    { input: band.data, left: Math.round((1200 - band.info.width) / 2), top: 560 + Math.round((70 - band.info.height) / 2) },
  ])
  .png()
  .toFile(join(PUB, 'og.png'));

const icon = async (size: number, file: string) =>
  sharp({ create: { width: size, height: size, channels: 4, background: BRAND.cream } })
    .composite([{ input: await sharp(join(ROOT, 'assets/mascot/happy.png')).resize(Math.round(size * 0.92)).toBuffer(), gravity: 'center' }])
    .png()
    .toFile(join(PUB, file));
await icon(64, 'favicon.png');
await icon(180, 'apple-touch-icon.png');
console.log('✓ web/public/og.png, favicon.png, apple-touch-icon.png');
