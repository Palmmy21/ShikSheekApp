/**
 * Build mascot expression PNGs from the brand sticker sheet.
 *   node scripts/build-mascots.ts
 *
 * One consistent character, cut once from assets/branding/sticker-sheet.png. The cream background
 * is removed by flood-filling from the image border; the chicken's dark outline stops the fill so
 * its white body is preserved. Output: assets/mascot/<name>.png (512x512, transparent).
 *
 * To swap in professionally drawn art later, replace the PNGs with the same names — nothing else changes.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SHEET = join(ROOT, 'assets/branding/sticker-sheet.png');
const OUT = join(ROOT, 'assets/mascot');

// [left, top, width, height] on the 1254x1254 sheet
const CROPS: Record<string, [number, number, number, number]> = {
  happy: [642, 102, 193, 184],
  excited: [850, 90, 195, 196],
  proud: [1055, 90, 195, 196],
  angry: [640, 335, 200, 200],
  worried: [850, 335, 195, 200],
  shocked: [1050, 335, 200, 198],
  sleepy: [630, 600, 215, 196],
  thinking: [860, 595, 185, 200],
  celebrating: [1050, 590, 200, 205],
  saving: [20, 880, 280, 262],
  planning: [335, 880, 280, 262],
  smart: [645, 870, 290, 272],
  discipline: [960, 870, 285, 272],
  encouraging: [30, 230, 478, 610], // the big thumbs-up chicken
};

const SIZE = 512;
// Sheet background, sampled at several clean points: rgb(253,245,230). The chicken's body is neutral
// white (R≈G≈B), so "background" additionally requires the warm cream tint (R − B ≥ 16). This keeps
// the flood fill out of the body even where a crop cuts through it at the edge.
const BG = [253, 245, 230] as const;
const TOLERANCE = 10;

async function cutout(name: string, [left, top, width, height]: [number, number, number, number]) {
  const { data, info } = await sharp(SHEET)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = (x: number, y: number) => (y * w + x) * 4;

  const isBg = (i: number) => {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    return Math.abs(r - BG[0]) <= TOLERANCE && Math.abs(g - BG[1]) <= TOLERANCE && Math.abs(b - BG[2]) <= TOLERANCE + 2 && r - b >= 16;
  };

  // iterative flood fill from every border pixel
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = y * w + x;
    if (visited[v]) continue;
    visited[v] = 1;
    const i = v * 4;
    if (!isBg(i)) continue;
    data[i + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // Anti-aliased cream fringe: pixels touching transparency that are still warm-tinted and light
  // are removed (2 passes) or faded, which hides the halo on dark backgrounds.
  const isFringe = (i: number) => {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    return r > 200 && g > 190 && r - b >= 9;
  };
  for (let pass = 0; pass < 2; pass++) {
    const clear: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = px(x, y);
        if (data[i + 3] === 0) continue;
        const touching = [px(x + 1, y), px(x - 1, y), px(x, y + 1), px(x, y - 1)].some((n) => data[n + 3] === 0);
        if (touching && isFringe(i)) clear.push(i);
      }
    }
    for (const i of clear) data[i + 3] = pass === 0 ? 0 : 90;
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(SIZE - 32, SIZE - 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));
}

mkdirSync(OUT, { recursive: true });
for (const [name, box] of Object.entries(CROPS)) {
  await cutout(name, box);
  console.log(`✓ ${name}.png`);
}
