/**
 * Build mascot expression PNGs from the brand sticker sheet.
 *   node scripts/build-mascots.ts
 *
 * Cut-out pipeline (per sticker):
 *  1. crop from the sheet (optionally erasing stray sheet elements) and upscale 3× (Lanczos) so the
 *     edge matte is computed at sub-pixel precision;
 *  2. background = cream pixels flood-filled from the border, plus enclosed cream pockets (gaps
 *     between arm and body). The chicken's body is neutral white (R≈G≈B), cream has R−B ≥ 14, so
 *     the fill can never eat into the body even where it is cut by the crop;
 *  3. edge matting: in a band along the boundary each pixel's alpha is solved from
 *     C = α·F + (1−α)·B, with B = the sheet cream and F = the nearest solid foreground colour, then the
 *     cream is removed from the colour ("decontamination") → smooth anti-aliased edges, no halo;
 *  4. drop small leftover specks, trim, downscale to 512×512 (which further smooths the edge).
 *
 * To swap in professionally drawn art later, replace the PNGs with the same names — nothing else changes.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SHEET = join(ROOT, 'assets/branding/sticker-sheet.png');
const OUT = join(ROOT, 'assets/mascot');

interface Crop {
  box: [number, number, number, number]; // left, top, width, height on the 1254² sheet
  erase?: Array<[number, number, number, number]>; // sheet-space rects painted with background first
}

const CROPS: Record<string, Crop> = {
  happy: { box: [642, 102, 193, 184] },
  excited: { box: [850, 90, 195, 196] },
  proud: { box: [1055, 90, 195, 196] },
  angry: { box: [640, 335, 200, 186] },
  worried: { box: [850, 335, 195, 200] },
  shocked: { box: [1050, 335, 200, 198] },
  sleepy: { box: [630, 600, 235, 196] },
  thinking: { box: [860, 595, 185, 200] },
  celebrating: { box: [1050, 590, 200, 205] },
  saving: { box: [20, 880, 280, 262] },
  planning: { box: [335, 880, 280, 262] },
  smart: { box: [645, 870, 290, 272] },
  discipline: { box: [960, 870, 285, 272] },
  // the big thumbs-up chicken; the brand colour swatches beside it are erased
  encouraging: { box: [30, 230, 520, 610], erase: [[508, 360, 70, 240]] },
};

const BG = [253, 245, 230] as const; // sheet cream, sampled at many clean points
const SCALE = 3;
const SIZE = 512;
const BAND = 3 * SCALE; // edge band width in upscaled px

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

function isCream(r: number, g: number, b: number, tol: number): boolean {
  return Math.abs(r - BG[0]) <= tol && Math.abs(g - BG[1]) <= tol && Math.abs(b - BG[2]) <= tol + 2 && r - b >= 14;
}

async function cutout(name: string, crop: Crop) {
  const [left, top, width, height] = crop.box;
  let base = sharp(SHEET).extract({ left, top, width, height });
  if (crop.erase?.length) {
    const rects = crop.erase.map(([x, y, w, h]) => `<rect x="${x - left}" y="${y - top}" width="${w}" height="${h}" fill="rgb(${BG.join(',')})"/>`).join('');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`);
    base = sharp(await base.png().toBuffer()).composite([{ input: svg }]);
  }
  const { data, info } = await sharp(await base.png().toBuffer())
    .resize(width * SCALE, height * SCALE, { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const N = w * h;
  const rgb = (i: number) => [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!] as const;

  // ── 1. background mask: border flood fill over cream ──
  const bg = new Uint8Array(N);
  const stack: number[] = [];
  const pushIf = (p: number) => {
    if (bg[p]) return;
    const [r, g, b] = rgb(p);
    if (isCream(r, g, b, 20)) {
      bg[p] = 1;
      stack.push(p);
    }
  };
  // Seed from top/left/right only: several stickers are sliced flat at the bottom (their label pill
  // covered them on the sheet), so seeding there would leak into the body's warm shading.
  for (let x = 0; x < w; x++) pushIf(x);
  for (let y = 0; y < h; y++) {
    pushIf(y * w);
    pushIf(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) pushIf(p - 1);
    if (x < w - 1) pushIf(p + 1);
    if (p >= w) pushIf(p - w);
    if (p < N - w) pushIf(p + w);
  }

  // ── 2. enclosed cream pockets (strict colour test, minimum size so tiny highlights survive) ──
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (bg[s] || seen[s]) continue;
    const [r, g, b] = rgb(s);
    if (!isCream(r, g, b, 6)) continue;
    const comp: number[] = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k]!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= N || seen[q] || bg[q]) continue;
        const [qr, qg, qb] = rgb(q);
        if (isCream(qr, qg, qb, 8)) {
          seen[q] = 1;
          comp.push(q);
        }
      }
    }
    if (comp.length < 60 * SCALE * SCALE) continue;
    // A real gap (e.g. between arm and body) is ringed by the dark outline; warm shading on the
    // white body is ringed by white. Only treat the pocket as background in the first case.
    const inComp = new Set(comp);
    let ring = 0;
    let dark = 0;
    for (const p of comp) {
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= N || inComp.has(q)) continue;
        ring++;
        const [qr, qg, qb] = rgb(q);
        if (qr + qg + qb < 420) dark++;
      }
    }
    if (ring > 0 && dark / ring > 0.72) for (const p of comp) bg[p] = 1;
  }

  if (process.env.DEBUG_MASK === name) {
    const dbg = Buffer.alloc(N * 3);
    for (let p = 0; p < N; p++) { const [r, g, b] = rgb(p); dbg[p*3] = bg[p] ? 0 : r; dbg[p*3+1] = bg[p] ? 255 : g; dbg[p*3+2] = bg[p] ? 0 : b; }
    await sharp(dbg, { raw: { width: w, height: h, channels: 3 } }).png().toFile(join(OUT, '..', '..', 'debug-' + name + '.png'));
  }
  // ── 3. distance (in px) from the background, up to BAND, via BFS ──
  const dist = new Uint16Array(N).fill(65535);
  const queue: number[] = [];
  for (let p = 0; p < N; p++) if (bg[p]) {
    dist[p] = 0;
    queue.push(p);
  }
  for (let k = 0; k < queue.length; k++) {
    const p = queue[k]!;
    const d = dist[p]!;
    if (d >= BAND) continue;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= N || dist[q]! <= d + 1) continue;
      dist[q] = d + 1;
      queue.push(q);
    }
  }

  // ── 4. matte the band: C = αF + (1−α)B, F = nearest solid foreground colour ──
  const out = Buffer.alloc(N * 4);
  const R = BAND + 2 * SCALE;
  for (let p = 0; p < N; p++) {
    const [r, g, b] = rgb(p);
    const o = p * 4;
    if (bg[p]) {
      out[o + 3] = 0;
      continue;
    }
    if (dist[p]! > BAND) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
      continue;
    }
    // Local edge colour: the nearest DARK pixel (the outline) if there is one, else the nearest solid pixel.
    const px = p % w;
    const py = (p - px) / w;
    let dark = -1;
    let darkD = Infinity;
    let solid = -1;
    let solidD = Infinity;
    for (let dy = -R; dy <= R; dy++) {
      const y = py + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = px + dx;
        if (x < 0 || x >= w) continue;
        const q = y * w + x;
        if (bg[q]) continue;
        const dd = dx * dx + dy * dy;
        const [qr, qg, qb] = rgb(q);
        if (qr + qg + qb < 330 && dd < darkD) {
          darkD = dd;
          dark = q;
        }
        if (dist[q]! > BAND && dd < solidD) {
          solidD = dd;
          solid = q;
        }
      }
    }
    const light = Math.min(r, g, b) >= 225;
    if (dark < 0 && light) {
      // white body meeting the crop edge directly (no outline between): it is art, keep it solid
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
      continue;
    }
    const F: readonly [number, number, number] = dark >= 0 ? rgb(dark) : solid >= 0 ? rgb(solid) : [62, 12, 5];
    const fb = [F[0] - BG[0], F[1] - BG[1], F[2] - BG[2]];
    const cb = [r - BG[0], g - BG[1], b - BG[2]];
    const denom = fb[0]! * fb[0]! + fb[1]! * fb[1]! + fb[2]! * fb[2]!;
    let a = denom > 900 ? (cb[0]! * fb[0]! + cb[1]! * fb[1]! + cb[2]! * fb[2]!) / denom : 1;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const saturatedArt = chroma > 70 && !isCream(r, g, b, 26);
    // saturated art (comb, beak, sparkles, sweat drops) is foreground even when small/thin
    if (saturatedArt) a = Math.max(a, 0.92);
    // near-white specks just outside an outline are paper grain, not art
    if (light && dist[p]! <= Math.ceil(1.5 * SCALE)) a = 0;
    a = clamp(a, 0, 1);
    if (a < 0.04) {
      out[o + 3] = 0;
      continue;
    }
    if (a < 0.9 && !saturatedArt) {
      // anti-aliased rim of the outline: pure line colour fading out → no light fringe
      out[o] = F[0];
      out[o + 1] = F[1];
      out[o + 2] = F[2];
    } else {
      out[o] = clamp(BG[0] + cb[0]! / a);
      out[o + 1] = clamp(BG[1] + cb[1]! / a);
      out[o + 2] = clamp(BG[2] + cb[2]! / a);
    }
    out[o + 3] = Math.round(a * 255);
  }

  // ── 5. drop specks left by the sheet's paper grain ──
  // (a) solid islands (α ≥ 50%) smaller than ~18 source px are grain, not art (confetti/sparkles are bigger)
  const strong = (p: number) => out[p * 4 + 3]! >= 128;
  const keep = new Uint8Array(N);
  const visited = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (visited[s] || !strong(s)) continue;
    const comp: number[] = [s];
    visited[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k]!;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= N || visited[q] || !strong(q)) continue;
        visited[q] = 1;
        comp.push(q);
      }
    }
    const isArt = comp.length >= 18 * SCALE * SCALE;
    for (const p of comp) {
      if (isArt) keep[p] = 1;
      else out[p * 4 + 3] = 0;
    }
  }
  // (b) faint pixels survive only as the anti-aliased rim of kept art (within ~1 source px)
  const rim = SCALE;
  for (let p = 0; p < N; p++) {
    const a = out[p * 4 + 3]!;
    if (a === 0 || keep[p]) continue;
    const px = p % w;
    const py = (p - px) / w;
    let near = false;
    for (let dy = -rim; dy <= rim && !near; dy++) {
      for (let dx = -rim; dx <= rim; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && keep[y * w + x]) {
          near = true;
          break;
        }
      }
    }
    if (!near) out[p * 4 + 3] = 0;
  }

  // ── 6. soft fade for stickers sliced flat at the bottom (so the cut reads as intentional) ──
  let lastRow = h - 1;
  while (lastRow > 0) {
    let any = false;
    for (let x = 0; x < w; x++) if (out[(lastRow * w + x) * 4 + 3]! > 0) { any = true; break; }
    if (any) break;
    lastRow--;
  }
  let firstRow = 0;
  outer: for (; firstRow < lastRow; firstRow++) for (let x = 0; x < w; x++) if (out[(firstRow * w + x) * 4 + 3]! > 0) break outer;
  let solidAtCut = 0;
  for (let x = 0; x < w; x++) if (out[(lastRow * w + x) * 4 + 3]! > 200) solidAtCut++;
  if (solidAtCut > w * 0.15) {
    const fade = Math.round((lastRow - firstRow) * 0.09);
    for (let y = lastRow - fade; y <= lastRow; y++) {
      const t = (lastRow - y) / fade; // 1 at fade start → 0 at the cut
      const k = t * t * (3 - 2 * t); // smoothstep
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4 + 3;
        out[i] = Math.round(out[i]! * k);
      }
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(SIZE - 32, SIZE - 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const [name, crop] of Object.entries(CROPS)) {
  if (only.length && !only.includes(name)) continue;
  const t = Date.now();
  await cutout(name, crop);
  console.log(`✓ ${name}.png (${Date.now() - t} ms)`);
}
