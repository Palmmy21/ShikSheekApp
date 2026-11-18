'use client';
/**
 * "ลองพิมพ์ดู" — a playful, simulated taste of the bot. Runs entirely in the browser with a tiny
 * subset of the real Thai parser (amounts, a handful of categories, income words, several items).
 * Nothing is sent or saved; the real bot is stricter and always confirms.
 */
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { CategoryIcon } from '@/components/icons';

interface Item {
  label: string;
  amount: number; // satang
  income: boolean;
  category: { id: string; label: string };
}

const CATS: Array<[RegExp, string, string]> = [
  [/เงินเดือน|โบนัส|ได้เงิน|ได้รับ|รายรับ/, 'salary', 'รายรับ'],
  [/ข้าว|กาแฟ|ชา|ขนม|อาหาร|ก๋วยเตี๋ยว|ส้มตำ|หมูกระทะ|ชาบู|ชานม|น้ำปั่น/, 'food', 'อาหาร'],
  [/น้ำมัน|แท็กซี่|grab|bts|mrt|รถ|ทางด่วน|วิน/i, 'transport', 'เดินทาง'],
  [/เน็ต|ไฟ|ค่าน้ำ|ห้อง|ผ่อน|netflix|spotify|บิล/i, 'bills', 'บิล/ค่าบริการ'],
  [/เสื้อ|รองเท้า|shopee|lazada|ช้อป|ของใช้/i, 'shopping', 'ช้อปปิ้ง'],
  [/ยา|หาหมอ|ยิม|gym|ฟิตเนส/i, 'health', 'สุขภาพ'],
  [/หนัง|เกม|เที่ยว|คอนเสิร์ต|เบียร์/, 'entertainment', 'บันเทิง'],
];

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|พัน|หมื่น)?/gi;

export function simulate(input: string): Item[] | 'unknown' | 'question' {
  const text = input.trim().toLowerCase();
  if (!text) return 'unknown';
  if (/เท่าไหร่|เท่าไร|เหลือ/.test(text) && !/\d/.test(text)) return 'question';
  const pieces: Item[] = [];
  let last = 0;
  for (const m of text.matchAll(AMOUNT)) {
    const label = text.slice(last, m.index).replace(/[,\n]|และ|กับ/g, ' ').trim();
    last = m.index! + m[0].length;
    const mult = m[3] ? (/k|พัน/i.test(m[3]) ? 1000 : 10000) : 1;
    const satang = (Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'))) * mult;
    if (!label || satang <= 0) return 'unknown';
    const hit = CATS.find(([re]) => re.test(label));
    const income = hit?.[1] === 'salary' || /^(ได้|รับ)/.test(label);
    pieces.push({ label, amount: satang, income, category: hit ? { id: hit[1], label: hit[2] } : { id: income ? 'other_income' : 'other_expense', label: 'อื่นๆ' } });
  }
  return pieces.length ? pieces.slice(0, 6) : 'unknown';
}

const baht = (s: number) => `฿${(s / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const SUGGESTIONS = ['กินข้าว 65', 'ข้าว 50 กาแฟ 40', 'ได้เงินเดือน 25000', 'เติมน้ำมัน 500'];

interface Turn {
  id: number;
  user: string;
  reply: Item[] | 'unknown' | 'question';
}

export function TryIt() {
  const [value, setValue] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [mood, setMood] = useState('happy');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  function submit(text: string) {
    const t = text.trim();
    if (!t) return;
    const reply = simulate(t);
    setTurns((prev) => [...prev.slice(-3), { id: Date.now(), user: t, reply }]);
    setMood(reply === 'unknown' ? 'thinking' : reply === 'question' ? 'smart' : reply.some((i) => i.income) ? 'celebrating' : 'happy');
    setValue('');
  }

  return (
    <div className="tryit">
      <div className="tryit__head">
        <img key={mood} src={`/mascot/${mood}.png`} alt="" width={64} height={64} className="tryit__mascot" />
        <div>
          <b>ลองพิมพ์คุยกับชิกชิกดู</b>
          <small>ตัวอย่างจำลองในเบราว์เซอร์ ไม่ส่งข้อมูลไปไหน</small>
        </div>
      </div>
      <div className="tryit__chat" ref={chatRef} aria-live="polite">
        {turns.length === 0 && <p className="tryit__empty">พิมพ์รายจ่าย หรือกดตัวอย่างด้านล่างเลย 👇</p>}
        {turns.map((t) => (
          <div key={t.id} className="tryit__turn">
            <div className="bubble bubble--me">{t.user}</div>
            <div className="tryit__reply">
              {t.reply === 'unknown' ? (
                <p>ชิกชิกงงนิดนึง 🤔 ลองพิมพ์ชื่อรายการตามด้วยจำนวนเงิน เช่น &ldquo;กาแฟ 80&rdquo;</p>
              ) : t.reply === 'question' ? (
                <p>ในแชทจริง ชิกชิกตอบได้เลยว่าใช้ไปเท่าไหร่ และยังใช้ได้อีกเท่าไหร่ 😉</p>
              ) : (
                <>
                  <p>{t.reply.length > 1 ? `จด ${t.reply.length} รายการนี้ใช่ไหม?` : 'จดแบบนี้ใช่ไหม?'}</p>
                  <ul>
                    {t.reply.map((i, k) => (
                      <li key={k}>
                        <CategoryIcon id={i.category.id} size={30} />
                        <span>{i.label}<small>{i.category.label}</small></span>
                        <b className={i.income ? 'pos' : ''}>{i.income ? '+' : ''}{baht(i.amount)}</b>
                      </li>
                    ))}
                  </ul>
                  <span className="tryit__confirm">ยืนยัน</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="tryit__chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="phrase phrase--btn" onClick={() => submit(s)}>{s}</button>
        ))}
      </div>
      <form className="tryit__input" onSubmit={(e) => { e.preventDefault(); submit(value); }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="เช่น ข้าวมันไก่ 55" aria-label="ลองพิมพ์รายการ" maxLength={80} />
        <button type="submit" aria-label="ส่ง"><Send size={18} /></button>
      </form>
    </div>
  );
}
