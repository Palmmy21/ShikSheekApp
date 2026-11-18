/** Manual check: how the configured AI reads loose edit sentences. node --env-file=.env.production scripts/try-edit.ts */
import { createAiFromConfig } from '../src/app.ts';
import { aiEditToIntent } from '../src/application/personality/ai-assist.ts';

const ai = createAiFromConfig(process.env as never);
if (!ai) throw new Error('No AI provider configured');
const context = 'bill: ค่าห้อง; bill: ค่าเน็ต AIS; bill: Netflix; goal: เที่ยวญี่ปุ่น; budget: อาหาร';
for (const text of ['ห้องขึ้นราคาละนะ เดือนหน้าเหลือ 3500 ละ', 'เน็ตย้ายไปจ่ายวันที่ 15 แทน', 'เลิกดู netflix แล้ว', 'ญี่ปุ่นอยากเก็บเดือนละ 4000']) {
  const t0 = Date.now();
  const intent = await ai.interpret(text, context);
  console.log(`${text}\n  → ${JSON.stringify(intent && aiEditToIntent(intent, text))} (${Date.now() - t0} ms)`);
}
