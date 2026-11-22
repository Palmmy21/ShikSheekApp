'use client';
/**
 * "อนาคตที่อยากมี" — dreams with the chicken as a travel companion: progress, a road of milestones
 * ("ด่าน"), this month's amount, a coach note, and (for long horizons) an educational "if your money
 * earned X%" box. All numbers come from the API; this file only presents them.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, PiggyBank, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { api, thaiDate, type DreamItem, type DreamKind, type DreamsResponse, type DreamTemplate } from '@/lib/liff-api';
import { Progress } from './Charts';
import { Sheet } from './TxnSheet';

const MILESTONES = [10, 25, 50, 75, 100];

const STATUS_TEXT: Record<DreamItem['status'], string> = {
  reached: 'ถึงเป้าแล้ว 🎉',
  starting: 'เพิ่งออกเดินทาง',
  ahead: 'นำหน้าแผน 🚀',
  on_track: 'ตามแผน ✓',
  behind: 'ช้ากว่าแผนนิดหน่อย',
  overdue: 'เลยวันที่ตั้งไว้',
};

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y + years, m - 1, Math.min(d, 28)));
  return t.toISOString().slice(0, 10);
}

export function DreamsSection({ version, today, refresh, toast, openDream }: {
  version: number;
  today: string;
  refresh: () => void;
  toast: (t: string) => void;
  /** from a chat link: 'new' opens the creator, an id opens "save into this dream" */
  openDream: string | null;
}) {
  const [data, setData] = useState<DreamsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(openDream === 'new');
  const [saving, setSaving] = useState<DreamItem | null>(null);
  const [adjusting, setAdjusting] = useState<DreamItem | null>(null);

  useEffect(() => {
    let alive = true;
    api<DreamsResponse>('/dreams').then((d) => {
      if (!alive) return;
      setData(d);
      if (openDream && openDream !== 'new') setSaving(d.items.find((i) => i.id === openDream) ?? null);
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [version, openDream]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast(ok); refresh(); } catch (e) { toast(e instanceof Error ? e.message : 'ไม่สำเร็จ'); }
  }

  return (
    <section className="card dreams">
      <div className="card__head">
        <h3>✨ อนาคตที่อยากมี</h3>
        <button className="link" onClick={() => setCreating(true)}><Plus size={15} /> ตั้งความฝัน</button>
      </div>
      {error ? <p className="form__error">{error}</p> : !data ? <div className="skeleton" aria-busy="true"><div /></div> : data.items.length === 0 ? (
        <button className="dream-empty" onClick={() => setCreating(true)}>
          <img src="/mascot/planning.png" alt="" width={84} height={84} />
          <span>
            <strong>อยากมีอนาคตแบบไหน?</strong>
            <small>บ้าน เที่ยวรอบโลก เปิดร้าน หรือเกษียณสบาย ชิกชิกจะคำนวณว่าต้องเก็บเดือนละเท่าไหร่ แบ่งเป็นด่าน แล้วเดินไปด้วยกันทุกเดือน</small>
          </span>
        </button>
      ) : (
        <ul className="dream-list">
          {data.items.map((d) => <DreamCard key={d.id} d={d} onSave={() => setSaving(d)} onAdjust={() => setAdjusting(d)} />)}
        </ul>
      )}

      {data && <DreamSheet open={creating} templates={data.templates} today={today} onClose={() => setCreating(false)} onCreate={(b) => act(() => api('/dreams', { method: 'POST', body: b }), 'ตั้งความฝันแล้ว ออกเดินทางกัน! 🐔')} />}
      <SaveSheet dream={saving} onClose={() => setSaving(null)} onSave={(amount) => act(() => api(`/goals/${saving!.id}/contribute`, { method: 'POST', body: { amount } }), 'เก็บเข้าความฝันแล้ว 🐷')} />
      <AdjustSheet dream={adjusting} today={today} onClose={() => setAdjusting(null)}
        onSave={(b) => act(() => api(`/dreams/${adjusting!.id}`, { method: 'PATCH', body: b }), 'ปรับแผนแล้ว')}
        onArchive={() => act(() => api(`/goals/${adjusting!.id}/archive`, { method: 'POST' }), 'เก็บความฝันนี้ไว้แล้ว')} />
    </section>
  );
}

function DreamCard({ d, onSave, onAdjust }: { d: DreamItem; onSave: () => void; onAdjust: () => void }) {
  return (
    <li className={`dream dream--${d.status}`}>
      <div className="dream__top">
        <span className="dream__emoji" aria-hidden="true">{d.emoji}</span>
        <span className="rows__main">{d.name}<small>{STATUS_TEXT[d.status]} · ถึง {thaiDate(d.targetDate, true)}</small></span>
        <b>{d.progressPercent}%</b>
      </div>
      <div className="dream__amount"><strong>{d.saved.text}</strong> <small>/ {d.target.text}</small></div>
      <Progress percent={d.progressPercent} level="goal" />
      <ol className="dream__road" aria-label="ด่านของความฝันนี้">
        {MILESTONES.map((m) => (
          <li key={m} className={m <= d.milestone ? 'is-done' : d.next?.percent === m ? 'is-next' : ''}>
            <span>{m <= d.milestone ? '🚩' : m === 100 ? d.emoji : ''}</span>
            <small>{m}%</small>
          </li>
        ))}
      </ol>

      <div className="coach">
        <img src={`/mascot/${d.coach.mascot}.png`} alt="" width={52} height={52} />
        <p><strong>{d.coach.headline}</strong>{d.coach.body}</p>
      </div>

      {d.status !== 'reached' && (
        <div className="dream__plan">
          <div><small>เดือนนี้ควรเก็บ</small><b>{d.monthlyNeeded.text}</b></div>
          <div><small>อีก</small><b>{d.monthsLeft} เดือน</b></div>
          {d.next && <div><small>ถึงด่าน {d.next.percent}%</small><b>อีก {d.next.amountToGo.text}</b></div>}
        </div>
      )}
      {d.reserving && d.status !== 'reached' && <p className="muted small">🔒 ชิกชิกกันเงินเดือนละ {d.monthlyNeeded.text} ไว้ให้แล้ว (หักจากยอดใช้ได้)</p>}

      {d.illustrations.length > 0 && (
        <details className="dream__learn">
          <summary>📚 ถ้าให้เงินทำงานด้วย จะเก็บน้อยลงแค่ไหน?</summary>
          <ul>
            {d.illustrations.map((i) => (
              <li key={i.ratePercent}>ถ้าได้ผลตอบแทนเฉลี่ย <b>{i.ratePercent}% ต่อปี</b> (สมมติ) เก็บเดือนละ <b>{i.monthly.text}</b> ก็พอ · น้อยลง {i.savesPerMonth.text}/เดือน</li>
            ))}
          </ul>
          <p className="muted small">ตัวเลขสมมติเพื่อการเรียนรู้เรื่องดอกเบี้ยทบต้น ไม่ใช่คำแนะนำการลงทุนและไม่รับประกันผลตอบแทน การลงทุนมีความเสี่ยง ผลตอบแทนอาจติดลบได้ ศึกษาข้อมูลก่อนตัดสินใจ</p>
        </details>
      )}

      <div className="budget__foot">
        <button className="chip" onClick={onAdjust}><SlidersHorizontal size={15} /> ปรับแผน</button>
        {d.status !== 'reached' && <button className="chip chip--primary" onClick={onSave}><PiggyBank size={15} /> เก็บเข้าฝันนี้</button>}
      </div>
    </li>
  );
}

function DreamSheet({ open, templates, today, onClose, onCreate }: { open: boolean; templates: DreamTemplate[]; today: string; onClose: () => void; onCreate: (b: object) => Promise<void> }) {
  const [kind, setKind] = useState<DreamKind>('home');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [reserve, setReserve] = useState(true);
  const t = templates.find((x) => x.kind === kind) ?? templates[0]!;

  useEffect(() => {
    if (!open) return;
    pick(templates[0]!.kind);
    setReserve(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(k: DreamKind) {
    const tpl = templates.find((x) => x.kind === k)!;
    setKind(k);
    setName(k === 'custom' ? '' : tpl.label);
    setTarget(String(tpl.suggested.satang / 100));
    setDate(addYears(today, tpl.suggestedYears));
  }

  // preview only — the server computes the real plan
  const preview = useMemo(() => {
    const amount = Number(target.replace(/,/g, ''));
    if (!amount || !date || date <= today) return null;
    const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const months = Math.max(1, (y - ty) * 12 + (m - tm) - (d < td ? 1 : 0));
    return { months, monthly: Math.ceil(amount / months / 10) * 10 };
  }, [target, date, today]);

  return (
    <Sheet open={open} onClose={onClose} title="อยากมีอนาคตแบบไหน?">
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onCreate({ kind, name: name || null, target, targetDate: date, reserve }); onClose(); }}>
        <div className="dream-picker" role="radiogroup" aria-label="แบบของความฝัน">
          {templates.map((x) => (
            <button type="button" key={x.kind} role="radio" aria-checked={x.kind === kind} className={x.kind === kind ? 'is-on' : ''} onClick={() => pick(x.kind)}>
              <span aria-hidden="true">{x.emoji}</span>{x.label}
            </button>
          ))}
        </div>
        <p className="muted small">{t.hint}</p>
        <label className="field"><span>ตั้งชื่อความฝัน</span><input required maxLength={60} placeholder="เช่น คอนโดใกล้ที่ทำงาน" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field field--amount"><span>ต้องใช้เงิน (บาท)</span><input required inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className="field"><span>อยากไปถึงภายใน</span><input required type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {preview && (
          <div className="coach coach--compact">
            <img src={`/mascot/${t.mascot}.png`} alt="" width={44} height={44} />
            <p>เก็บเดือนละประมาณ <strong>฿{preview.monthly.toLocaleString('en-US')}</strong> อีก {preview.months} เดือนก็ถึง ชิกชิกจะเดินไปด้วยกันนะ</p>
          </div>
        )}
        <label className="toggle-row">
          <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} />
          <span>กันเงินก้อนนี้ไว้ทุกเดือน (หักจากยอดใช้ได้ เก็บก่อนใช้)</span>
        </label>
        <button className="btn btn--primary btn--block"><Sparkles size={18} /> เริ่มเดินทาง</button>
      </form>
    </Sheet>
  );
}

function SaveSheet({ dream, onClose, onSave }: { dream: DreamItem | null; onClose: () => void; onSave: (amount: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  useEffect(() => { if (dream) setAmount(String(dream.monthlyNeeded.satang / 100 || '')); }, [dream]);
  return (
    <Sheet open={!!dream} onClose={onClose} title={`เก็บเข้า ${dream?.name ?? ''}`}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onSave(amount); onClose(); }}>
        <label className="field field--amount"><span>จำนวนเงิน (บาท)</span><input required autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {dream && <p className="muted small">แผนเดือนนี้ {dream.monthlyNeeded.text}</p>}
        <button className="btn btn--primary btn--block"><Check size={18} /> เก็บเลย</button>
      </form>
    </Sheet>
  );
}

function AdjustSheet({ dream, today, onClose, onSave, onArchive }: { dream: DreamItem | null; today: string; onClose: () => void; onSave: (b: object) => Promise<void>; onArchive: () => Promise<void> }) {
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [reserve, setReserve] = useState(true);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    if (!dream) return;
    setTarget(String(dream.target.satang / 100));
    setDate(dream.targetDate > today ? dream.targetDate : addYears(today, 1));
    setReserve(dream.reserving);
    setConfirmArchive(false);
  }, [dream, today]);
  return (
    <Sheet open={!!dream} onClose={onClose} title={`ปรับแผน ${dream?.name ?? ''}`}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onSave({ target, targetDate: date, reserve }); onClose(); }}>
        <label className="field field--amount"><span>ต้องใช้เงิน (บาท)</span><input required inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className="field"><span>อยากไปถึงภายใน</span><input required type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="toggle-row">
          <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} />
          <span>กันเงินไว้ทุกเดือน (หักจากยอดใช้ได้)</span>
        </label>
        <button className="btn btn--primary btn--block"><Check size={18} /> บันทึกแผน</button>
        <button type="button" className="btn btn--danger-ghost btn--block" onClick={async () => { if (!confirmArchive) { setConfirmArchive(true); return; } await onArchive(); onClose(); }}>
          {confirmArchive ? 'กดอีกครั้งเพื่อเก็บความฝันนี้ (เงินที่เก็บแล้วยังอยู่)' : 'เก็บความฝันนี้ออกจากรายการ'}
        </button>
      </form>
    </Sheet>
  );
}
