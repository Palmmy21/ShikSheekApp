'use client';
/**
 * "ห้องเรียนลงทุน" — general investing basics + a compound-growth calculator. Education only:
 * no product, fund or stock picks and no personalised allocation (owner decision; personalised
 * investment advice in Thailand requires an SEC licence).
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, type CompoundResult } from '@/lib/liff-api';

const LESSONS: Array<{ emoji: string; title: string; body: string[] }> = [
  { emoji: '🧱', title: 'ก่อนลงทุน: เงินสำรองฉุกเฉินมาก่อน', body: [
    'ควรมีเงินสำรองอย่างน้อย 3–6 เท่าของค่าใช้จ่ายต่อเดือน เก็บในที่ถอนได้ทันที',
    'ปลดหนี้ดอกเบี้ยสูง เช่น บัตรเครดิต หรือสินเชื่อส่วนบุคคล ก่อน เพราะดอกเบี้ยที่จ่ายมักสูงกว่าผลตอบแทนที่หาได้',
  ] },
  { emoji: '🌱', title: 'ดอกเบี้ยทบต้น: ให้เวลาทำงาน', body: [
    'ผลตอบแทนที่ได้ถูกนำไปต่อยอดรอบถัดไป ยิ่งเวลานาน ส่วนที่ "งอก" ยิ่งเร่งตัว',
    'เริ่มเร็วด้วยเงินน้อย มักชนะเริ่มช้าด้วยเงินมาก ลองเล่นเครื่องคิดเลขด้านล่างดู',
  ] },
  { emoji: '⚖️', title: 'ความเสี่ยงมาคู่กับผลตอบแทน', body: [
    'เงินฝาก: เสี่ยงต่ำ ผลตอบแทนต่ำ เหมาะกับเงินที่ต้องใช้เร็ว',
    'ตราสารหนี้ (เช่น พันธบัตร หุ้นกู้): ความเสี่ยงและผลตอบแทนปานกลาง แต่ผู้ออกอาจผิดนัดชำระได้',
    'หุ้น: ผันผวนสูง ระยะสั้นอาจติดลบหนัก แต่ในระยะยาวมีโอกาสได้ผลตอบแทนสูงกว่า',
    'ไม่มีอะไรที่ "ผลตอบแทนสูงและไม่มีความเสี่ยง"',
  ] },
  { emoji: '⏳', title: 'จับคู่เงินกับระยะเวลา', body: [
    'เงินที่ต้องใช้ภายในราว 3 ปี (เที่ยว ดาวน์รถ) ควรอยู่ในที่ปลอดภัยและถอนง่าย',
    'เงินที่ไม่ต้องใช้อีก 5–10 ปีขึ้นไป (เกษียณ) รับความผันผวนได้มากกว่า เพราะมีเวลาให้ฟื้นตัว',
  ] },
  { emoji: '🧺', title: 'กระจายความเสี่ยง', body: [
    'อย่าใส่ไข่ทั้งหมดในตะกร้าใบเดียว กระจายไปหลายสินทรัพย์ หลายอุตสาหกรรม และหลายประเทศ',
    'กองทุนรวมเป็นวิธีหนึ่งที่ช่วยกระจายได้ด้วยเงินไม่มาก แต่ต้องอ่านหนังสือชี้ชวนก่อน',
  ] },
  { emoji: '📅', title: 'DCA: ลงทุนสม่ำเสมอ', body: [
    'แบ่งลงทุนเท่าๆ กันทุกเดือน ไม่ต้องเดาจังหวะตลาด ช่วงราคาถูกจะได้หน่วยมากขึ้นเอง',
    'ช่วยสร้างวินัยแบบเดียวกับ "เก็บก่อนใช้" ของชิกชิก',
  ] },
  { emoji: '🧾', title: 'ค่าธรรมเนียมกินผลตอบแทนเงียบๆ', body: [
    'ต่างกันปีละ 1% ดูเหมือนน้อย แต่ผ่านไป 20 ปี ผลต่างอาจเป็นหลักแสน',
    'เทียบค่าธรรมเนียมรวมต่อปีทุกครั้งก่อนเลือก',
  ] },
  { emoji: '🏛️', title: 'สิทธิลดหย่อนภาษี', body: [
    'มีกองทุนบางประเภทที่นำไปลดหย่อนภาษีได้ แต่มีเงื่อนไข เช่น ระยะเวลาถือครองและวงเงิน',
    'เงื่อนไขเปลี่ยนได้ทุกปี ตรวจสอบล่าสุดกับกรมสรรพากรหรือ บลจ. ก่อนซื้อ',
  ] },
  { emoji: '🚨', title: 'สัญญาณกลโกงและแชร์ลูกโซ่', body: [
    'การันตีผลตอบแทนสูงแบบต่อเดือน รีบให้โอนเงิน หรือได้เงินมากขึ้นเมื่อชวนคนต่อ แบบนี้ให้สงสัยไว้ก่อน',
    'ตรวจสอบรายชื่อผู้ได้รับอนุญาตได้ที่เว็บไซต์ ก.ล.ต. (sec.or.th) ก่อนโอนเงินทุกครั้ง',
  ] },
  { emoji: '🤝', title: 'อยากได้คำแนะนำเฉพาะตัว?', body: [
    'ปรึกษาผู้แนะนำการลงทุนหรือนักวางแผนการเงินที่ได้รับอนุญาต และทำแบบประเมินความเสี่ยง (Suitability Test) ก่อนลงทุน',
  ] },
];

const RATES = [0, 2, 5, 7];

export function LearnRoom({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="ห้องเรียนลงทุน">
      <header className="overlay__top">
        <div><strong>📚 ห้องเรียนลงทุน</strong><small>พื้นฐานก่อนให้เงินทำงาน</small></div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด"><X size={22} /></button>
      </header>
      <main className="overlay__body">
        <div className="coach">
          <img src="/mascot/smart.png" alt="" width={56} height={56} />
          <p><strong>มีเงินเหลือเก็บแล้ว ต่อยอดยังไงดี?</strong>ชิกชิกสรุปพื้นฐานไว้ให้ อ่านทีละข้อ แล้วลองเล่นเครื่องคิดเลขดูนะ</p>
        </div>
        <Calculator />
        <section className="card">
          <div className="card__head"><h3>บทเรียนสั้นๆ</h3></div>
          <div className="lessons">
            {LESSONS.map((l) => (
              <details key={l.title} className="lesson">
                <summary><span aria-hidden="true">{l.emoji}</span>{l.title}</summary>
                <ul>{l.body.map((b) => <li key={b}>{b}</li>)}</ul>
              </details>
            ))}
          </div>
        </section>
        <p className="disclaimer">ข้อมูลนี้เป็นความรู้ทั่วไปเพื่อการศึกษา ไม่ใช่คำแนะนำให้ซื้อขายหลักทรัพย์หรือกองทุนใดๆ และไม่ได้พิจารณาสถานะการเงินของคุณเป็นรายบุคคล การลงทุนมีความเสี่ยง ผู้ลงทุนควรศึกษาข้อมูลก่อนตัดสินใจลงทุน</p>
      </main>
    </div>
  );
}

function Calculator() {
  const [monthly, setMonthly] = useState('1000');
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(5);
  const [r, setR] = useState<CompoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const amount = monthly.replace(/,/g, '');
    if (!Number(amount)) { setR(null); return; }
    const t = setTimeout(() => {
      api<CompoundResult>('/learn/compound', { method: 'POST', body: { monthly: amount, rateBp: Math.round(rate * 100), years } })
        .then((x) => { setR(x); setError(null); })
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [monthly, years, rate]);

  const max = r ? Math.max(1, ...r.series.map((p) => p.balance.satang)) : 1;
  const W = 320;
  const H = 120;
  const bw = r ? W / r.series.length : 0;

  return (
    <section className="card calc">
      <div className="card__head"><h3>🌱 เครื่องคิดเลขดอกเบี้ยทบต้น</h3></div>
      <label className="field field--amount"><span>เก็บเดือนละ (บาท)</span><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
      <label className="field"><span>นานกี่ปี: <b>{years} ปี</b></span><input type="range" min={1} max={40} value={years} onChange={(e) => setYears(Number(e.target.value))} /></label>
      <div className="field"><span>ผลตอบแทนเฉลี่ยต่อปี (สมมติ)</span>
        <div className="chips">{RATES.map((x) => <button type="button" key={x} className={`chip${x === rate ? ' chip--primary' : ''}`} onClick={() => setRate(x)}>{x}%</button>)}</div>
      </div>
      {error && <p className="form__error">{error}</p>}
      {r && (
        <>
          <div className="calc__result">
            <div><small>เงินที่ใส่ไป</small><b>{r.deposited.text}</b></div>
            <div><small>ส่วนที่งอกเงย</small><b className="pos">{r.growth.text}</b></div>
            <div><small>รวมเป็น</small><b>{r.balance.text}</b></div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="calc__chart" role="img" aria-label={`หลัง ${years} ปี ใส่ไป ${r.deposited.text} รวมเป็น ${r.balance.text}`}>
            {r.series.map((p, i) => {
              const h = (p.balance.satang / max) * (H - 4);
              const hd = (p.deposited.satang / max) * (H - 4);
              return (
                <g key={p.year}>
                  <rect x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={2} fill="#2e9e6a" opacity={0.35} />
                  <rect x={i * bw + 1} y={H - hd} width={Math.max(1, bw - 2)} height={hd} rx={2} fill="#e93636" />
                </g>
              );
            })}
          </svg>
          <p className="muted small"><span className="dot dot--red" /> เงินที่ใส่ไป <span className="dot dot--green" /> ส่วนที่งอกเงย · ตัวเลขสมมติ ผลตอบแทนจริงขึ้นลงได้และอาจติดลบ</p>
        </>
      )}
    </section>
  );
}
