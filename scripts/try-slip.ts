/** Manual check: render a MOCK slip and read it with the configured AI provider. node --env-file=.env.production scripts/try-slip.ts */
import sharp from 'sharp';
import { join } from 'node:path';
import { createAiFromConfig } from '../src/app.ts';
import { prepareImport } from '../src/application/services/import-service.ts';

const FONT = join(import.meta.dirname, '..', 'assets/fonts/Prompt-SemiBold.ttf');
const lines = [
  ['โอนเงินสำเร็จ', 40, '#1F8A4C'],
  ['18 พ.ย. 69  14:32 น.', 26, '#555555'],
  ['จาก  นาย ปาล์ม ทดสอบ', 28, '#222222'],
  ['xxx-x-x1234-x  ธ.กสิกรไทย', 22, '#777777'],
  ['ไปยัง  ร้านกาแฟดอยช้าง', 28, '#222222'],
  ['xxx-x-x5678-x  ธ.ไทยพาณิชย์', 22, '#777777'],
  ['จำนวนเงิน', 24, '#555555'],
  ['1,250.00 บาท', 46, '#111111'],
  ['ค่าธรรมเนียม  0.00 บาท', 22, '#777777'],
  ['เลขที่รายการ: 016322143052ABC12345', 22, '#555555'],
] as const;
const parts = await Promise.all(lines.map(([t, px, color]) => sharp({ text: { text: `<span foreground="${color}">${t}</span>`, font: `Prompt ${px}px`, fontfile: FONT, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true })));
let y = 40;
const composites = parts.map((p) => { const c = { input: p.data, left: 50, top: y }; y += p.info.height + 18; return c; });
const img = await sharp({ create: { width: 640, height: y + 40, channels: 3, background: '#FFFFFF' } }).composite(composites).jpeg({ quality: 90 }).toBuffer();

const ai = createAiFromConfig(process.env as never);
if (!ai) throw new Error('No AI provider configured');
const t0 = Date.now();
const out = await ai.extractDocument(new Uint8Array(img), 'image/jpeg');
console.log(`extracted in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(out));
if (out) console.log('after guards:', JSON.stringify((await prepareImport(out, '2026-11-18')).rows));
