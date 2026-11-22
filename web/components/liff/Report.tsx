'use client';
/**
 * "รายงานรายรับรายจ่าย" — pick a range, preview the statement as a clean document, then save it as
 * PDF (the browser's print → "Save as PDF") or download an Excel-friendly CSV. LINE's in-app browser
 * can't always print/download, so we offer "open in browser" there.
 */
import { useEffect, useState } from 'react';
import { Download, ExternalLink, Printer, X } from 'lucide-react';
import { api, apiText, inLineClient, openExternal, thaiDate, type Statement } from '@/lib/liff-api';

type Preset = 'this_month' | 'last_month' | 'three_months' | 'this_year' | 'last_year' | 'custom';
const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'this_month', label: 'เดือนนี้' },
  { id: 'last_month', label: 'เดือนก่อน' },
  { id: 'three_months', label: '3 เดือนล่าสุด' },
  { id: 'this_year', label: 'ปีนี้' },
  { id: 'last_year', label: 'ปีที่แล้ว' },
  { id: 'custom', label: 'กำหนดเอง' },
];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function rangeFor(preset: Preset, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'last_month': return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case 'three_months': return { from: iso(y, m - 2, 1), to: today };
    case 'this_year': return { from: iso(y, 1, 1), to: today };
    case 'last_year': return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) };
    default: return { from: iso(y, m, 1), to: today };
  }
}

const TYPE_TH = { income: 'รายรับ', expense: 'รายจ่าย', saving: 'เงินออม' } as const;
const monthLabel = (key: string) => thaiDate(`${key}-01`, true).replace(/^1 /, '');

export function ReportScreen({ today, onClose }: { today: string; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('this_month');
  const [range, setRange] = useState(() => rangeFor('this_month', today));
  const [st, setSt] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inLine = inLineClient();

  useEffect(() => {
    let alive = true;
    setSt(null);
    setError(null);
    api<Statement>(`/reports/statement?from=${range.from}&to=${range.to}`)
      .then((s) => alive && setSt(s))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [range]);

  function choose(p: Preset) {
    setPreset(p);
    if (p !== 'custom') setRange(rangeFor(p, today));
  }

  async function downloadCsv() {
    setBusy(true);
    try {
      const csv = await apiText(`/reports/statement.csv?from=${range.from}&to=${range.to}`);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `shiksheek-report-${range.from}-${range.to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดาวน์โหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay report" role="dialog" aria-modal="true" aria-label="รายงานรายรับรายจ่าย">
      <header className="overlay__top no-print">
        <div><strong>📄 รายงานรายรับรายจ่าย</strong><small>บันทึกเป็น PDF หรือ Excel</small></div>
        <button className="icon-btn" onClick={onClose} aria-label="ปิด"><X size={22} /></button>
      </header>
      <main className="overlay__body">
        <section className="card no-print">
          <div className="chips">{PRESETS.map((p) => <button key={p.id} className={`chip${p.id === preset ? ' chip--primary' : ''}`} onClick={() => choose(p.id)}>{p.label}</button>)}</div>
          {preset === 'custom' && (
            <div className="report__range">
              <label className="field"><span>ตั้งแต่</span><input type="date" max={today} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
              <label className="field"><span>ถึง</span><input type="date" max={today} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
            </div>
          )}
          <div className="report__actions">
            <button className="btn btn--primary" disabled={!st} onClick={() => window.print()}><Printer size={18} /> บันทึก PDF</button>
            <button className="btn" disabled={!st || busy} onClick={downloadCsv}><Download size={18} /> Excel (CSV)</button>
          </div>
          {inLine && (
            <button className="link" onClick={() => openExternal(`${window.location.origin}/liff/?tab=report`)}><ExternalLink size={15} /> ถ้ากดแล้วไม่มีอะไรขึ้น เปิดในเบราว์เซอร์</button>
          )}
          <p className="muted small">PDF: กด "บันทึก PDF" แล้วเลือก "บันทึกเป็น PDF" ในหน้าพิมพ์</p>
        </section>

        {error && <p className="form__error">{error}</p>}
        {!st && !error && <div className="skeleton" aria-busy="true"><div /><div /><div /></div>}
        {st && <StatementDoc st={st} />}
      </main>
    </div>
  );
}

function StatementDoc({ st }: { st: Statement }) {
  return (
    <article className="statement">
      <header className="statement__head">
        <img src="/favicon.png" alt="" width={40} height={40} />
        <div>
          <h1>รายงานรายรับรายจ่าย</h1>
          <p>{st.name ?? 'ผู้ใช้ชิกชิก'} · {thaiDate(st.range.start, true)} – {thaiDate(st.range.end, true)} ({st.days} วัน)</p>
        </div>
      </header>

      <div className="statement__totals">
        <div><small>รายรับรวม</small><b className="pos">{st.income.text}</b></div>
        <div><small>รายจ่ายรวม</small><b>{st.expense.text}</b></div>
        <div><small>โอนเข้าเงินออม</small><b>{st.saving.text}</b></div>
        <div><small>คงเหลือสุทธิ</small><b className={st.net.satang < 0 ? 'neg' : ''}>{st.net.text}</b></div>
      </div>
      {st.keptPercent !== null && <p className="muted small">เก็บได้ {st.keptPercent}% ของรายรับ (รายรับ − รายจ่าย)</p>}

      {st.months.length > 1 && (
        <>
          <h2>แยกตามเดือน</h2>
          <table>
            <thead><tr><th>เดือน</th><th>รายรับ</th><th>รายจ่าย</th><th>ออม</th><th>สุทธิ</th></tr></thead>
            <tbody>{st.months.map((m) => <tr key={m.key}><td>{monthLabel(m.key)}</td><td>{m.income.text}</td><td>{m.expense.text}</td><td>{m.saving.text}</td><td className={m.net.satang < 0 ? 'neg' : ''}>{m.net.text}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {st.expenseByCategory.length > 0 && (
        <>
          <h2>รายจ่ายตามหมวด</h2>
          <table>
            <thead><tr><th>หมวด</th><th>รายการ</th><th>จำนวนเงิน</th><th>%</th></tr></thead>
            <tbody>{st.expenseByCategory.map((c) => <tr key={c.id}><td>{c.label}</td><td>{c.count}</td><td>{c.amount.text}</td><td>{c.percent}%</td></tr>)}</tbody>
          </table>
        </>
      )}
      {st.incomeByCategory.length > 0 && (
        <>
          <h2>รายรับตามหมวด</h2>
          <table>
            <thead><tr><th>หมวด</th><th>รายการ</th><th>จำนวนเงิน</th><th>%</th></tr></thead>
            <tbody>{st.incomeByCategory.map((c) => <tr key={c.id}><td>{c.label}</td><td>{c.count}</td><td>{c.amount.text}</td><td>{c.percent}%</td></tr>)}</tbody>
          </table>
        </>
      )}

      <h2>รายการทั้งหมด ({st.rows.length})</h2>
      {st.rows.length === 0 ? <p className="muted small">ไม่มีรายการในช่วงนี้</p> : (
        <table className="statement__rows">
          <thead><tr><th>วันที่</th><th>ประเภท</th><th>หมวด / บันทึก</th><th>จำนวนเงิน</th></tr></thead>
          <tbody>
            {st.rows.map((r, i) => (
              <tr key={i}><td>{thaiDate(r.date, true)}</td><td>{TYPE_TH[r.type]}</td><td>{r.category}{r.note ? ` · ${r.note}` : ''}</td><td className={r.type === 'income' ? 'pos' : ''}>{r.amount.text}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="statement__foot">สร้างโดย ShikSheek ชิกชิก เมื่อ {thaiDate(st.generatedOn, true)} · จากข้อมูลที่ผู้ใช้บันทึกเอง</footer>
    </article>
  );
}
