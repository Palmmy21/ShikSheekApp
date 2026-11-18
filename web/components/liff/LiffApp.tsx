'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  api, initLiff, thaiDate,
  type BudgetItem, type Category, type Dashboard, type FixedCostItem, type GoalItem, type Me, type MonthReport, type Txn,
} from '@/lib/liff-api';
import { CategoryBars, DailyBars, Progress } from './Charts';
import { Sheet, TxnSheet, type TxnInput } from './TxnSheet';

type Tab = 'home' | 'txns' | 'bills' | 'plans' | 'settings';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: 'ภาพรวม', icon: '🏠' },
  { id: 'txns', label: 'รายการ', icon: '📜' },
  { id: 'bills', label: 'บิล', icon: '📅' },
  { id: 'plans', label: 'งบ & ออม', icon: '🎯' },
  { id: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

function useToast() {
  const [msg, setMsg] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4500);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, show: (text: string, undo?: () => void) => setMsg({ text, ...(undo ? { undo } : {}) }), clear: () => setMsg(null) };
}

export default function LiffApp() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fatal, setFatal] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tab, setTab] = useState<Tab>('home');
  const [version, setVersion] = useState(0); // bump to refetch screens
  const [sheet, setSheet] = useState<{ open: boolean; editing: Txn | null }>({ open: false, editing: null });
  const toast = useToast();
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    (async () => {
      try {
        await initLiff();
        const [m, c] = await Promise.all([api<Me>('/me'), api<Category[]>('/categories')]);
        setMe(m);
        setCategories(c);
        setPhase('ready');
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
  }, []);

  async function saveTxn(input: TxnInput) {
    const payload = { ...input, note: input.note || null };
    if (sheet.editing) await api(`/transactions/${sheet.editing.id}`, { method: 'PATCH', body: payload });
    else await api('/transactions', { method: 'POST', body: payload });
    toast.show(sheet.editing ? 'แก้ไขแล้ว ✓' : 'จดแล้วจ้า 🐔');
    refresh();
  }

  async function deleteTxn(t: Txn) {
    await api(`/transactions/${t.id}`, { method: 'DELETE' });
    refresh();
    toast.show('ลบแล้ว', async () => {
      await api(`/transactions/${t.id}/restore`, { method: 'POST' });
      toast.show('เอากลับมาแล้ว ✓');
      refresh();
    });
  }

  if (phase === 'loading') {
    return (
      <div className="lf-splash">
        <img src="/mascot/happy.png" alt="" width={120} height={120} />
        <p>ชิกชิกกำลังเปิดสมุดบัญชี…</p>
      </div>
    );
  }
  if (phase === 'error' || !me) {
    return (
      <div className="lf-splash">
        <img src="/mascot/worried.png" alt="" width={120} height={120} />
        <p>เปิดแอปไม่สำเร็จ</p>
        <small className="muted">{fatal}</small>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>ลองใหม่</button>
      </div>
    );
  }

  const props = { me, categories, version, refresh, toast: toast.show, openEdit: (t: Txn) => setSheet({ open: true, editing: t }) };
  return (
    <div className="lf">
      <header className="lf-top">
        <img src="/mascot/happy.png" alt="" width={36} height={36} />
        <div>
          <small>ShikSheek</small>
          <strong>{TABS.find((t) => t.id === tab)!.label}</strong>
        </div>
        <span className="lf-top__hi">สวัสดี {me.displayName ?? ''}</span>
      </header>

      <main className="lf-main">
        {tab === 'home' && <HomeScreen {...props} goTo={setTab} />}
        {tab === 'txns' && <TxnScreen {...props} />}
        {tab === 'bills' && <BillsScreen {...props} />}
        {tab === 'plans' && <PlansScreen {...props} />}
        {tab === 'settings' && <SettingsScreen {...props} onSaved={(m) => setMe(m)} />}
      </main>

      {(tab === 'home' || tab === 'txns') && (
        <button className="fab" onClick={() => setSheet({ open: true, editing: null })} aria-label="จดรายการใหม่">＋</button>
      )}

      <nav className="lf-tabs" aria-label="เมนู">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <TxnSheet
        open={sheet.open}
        editing={sheet.editing}
        onClose={() => setSheet({ open: false, editing: null })}
        categories={categories}
        today={me.today}
        onSubmit={saveTxn}
        onDelete={deleteTxn}
      />

      {toast.msg && (
        <div className="toast" role="status">
          <span>{toast.msg.text}</span>
          {toast.msg.undo && <button onClick={() => { const u = toast.msg!.undo!; toast.clear(); void u(); }}>เอากลับ</button>}
        </div>
      )}
    </div>
  );
}

interface ScreenProps {
  me: Me;
  categories: Category[];
  version: number;
  refresh: () => void;
  toast: (text: string, undo?: () => void) => void;
  openEdit: (t: Txn) => void;
}

function useData<T>(path: string | null, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path).then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [path, version]);
  return { data, error };
}

function Loading({ error }: { error?: string | null }) {
  return error ? <p className="form__error">{error}</p> : <div className="skeleton" aria-busy="true"><div /><div /><div /></div>;
}

// ── HOME ──
function HomeScreen({ me, version, goTo }: ScreenProps & { goTo: (t: Tab) => void }) {
  const { data: d, error } = useData<Dashboard>('/dashboard', version);
  const { data: rep } = useData<MonthReport>('/reports/month', version);
  if (!d) return <Loading error={error} />;
  const mood = d.isNegative ? 'shocked' : !d.hasIncome ? 'thinking' : d.available.satang * 10 < d.income.satang ? 'worried' : d.available.satang * 2 >= d.income.satang ? 'proud' : 'happy';
  return (
    <>
      <section className={`hero-card${d.isNegative ? ' is-negative' : ''}`}>
        <div>
          <small>ใช้ได้อีก · {thaiDate(d.period.start)} – {thaiDate(d.period.end)}</small>
          <strong className="hero-card__num">{d.available.text}</strong>
          <span>{d.dailyAllowance.satang > 0 ? `≈ วันละ ${d.dailyAllowance.text} · เหลือ ${d.daysRemaining} วัน` : `เหลือ ${d.daysRemaining} วันในรอบนี้`}</span>
        </div>
        <img src={`/mascot/${mood}.png`} alt="" width={92} height={92} />
      </section>
      {!d.hasIncome && <p className="hint">ยังไม่มีรายรับในรอบนี้ — กด ＋ แล้วเลือก "รายรับ" เพื่อเริ่ม</p>}

      <section className="card stats">
        <div><small>รายรับ</small><b className="pos">{d.income.text}</b></div>
        <div><small>ใช้ไปแล้ว</small><b>{d.expense.text}</b></div>
        <div><small>บิลค้างจ่าย</small><b>{d.unpaidBills.text}</b></div>
        <div><small>วันนี้ใช้ไป</small><b>{d.today.text}</b></div>
      </section>

      {rep && (
        <section className="card">
          <DailyBars data={rep.daily} today={me.today} />
        </section>
      )}

      {d.upcomingBills.length > 0 && (
        <section className="card">
          <div className="card__head"><h3>บิลใกล้ถึง</h3><button className="link" onClick={() => goTo('bills')}>ทั้งหมด →</button></div>
          <ul className="list">
            {d.upcomingBills.map((b) => (
              <li key={b.occurrenceId}><span>{b.name}<small className={b.status === 'overdue' ? 'neg' : 'muted'}>{statusText(b.status, b.dueDate)}</small></span><b>{b.amount.text}</b></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card__head"><h3>ใช้กับอะไรบ้าง</h3></div>
        <CategoryBars items={d.topCategories} total={d.expense.satang} />
      </section>
    </>
  );
}

function statusText(status: string, due: string) {
  if (status === 'overdue') return `เลยกำหนด · ${thaiDate(due)}`;
  if (status === 'due') return 'ครบกำหนดวันนี้';
  return `ครบ ${thaiDate(due)}`;
}

// ── TRANSACTIONS ──
function TxnScreen({ version, openEdit, categories }: ScreenProps) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | 'expense' | 'income'>('');
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ page: String(page), ...(q ? { q } : {}), ...(type ? { type } : {}), ...(cat ? { category: cat } : {}) });
  const { data, error } = useData<{ items: Txn[]; hasMore: boolean }>(`/transactions?${params}`, version);
  useEffect(() => setPage(0), [q, type, cat]);

  const groups = new Map<string, Txn[]>();
  for (const t of data?.items ?? []) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);

  return (
    <>
      <div className="filters">
        <input type="search" placeholder="ค้นหาโน้ต…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="ประเภท">
          <option value="">ทุกประเภท</option><option value="expense">รายจ่าย</option><option value="income">รายรับ</option>
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="หมวด">
          <option value="">ทุกหมวด</option>
          {categories.filter((c) => c.kind !== 'saving').map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
      </div>
      {!data ? <Loading error={error} /> : data.items.length === 0 ? (
        <div className="empty"><img src="/mascot/thinking.png" alt="" width={96} height={96} /><p>ไม่พบรายการ</p></div>
      ) : (
        [...groups.entries()].map(([date, items]) => (
          <section key={date} className="card card--tight">
            <h4 className="daygroup">{thaiDate(date, true)}</h4>
            <ul className="list list--tap">
              {items.map((t) => (
                <li key={t.id}>
                  <button onClick={() => t.type !== 'saving' && openEdit(t)} disabled={t.type === 'saving'}>
                    <span className="emoji" aria-hidden="true">{t.category.emoji}</span>
                    <span className="grow">{t.note ?? t.category.label}<small className="muted">{t.category.label}{t.isBillPayment ? ' · จ่ายบิล' : ''}{t.source === 'slip' ? ' · สลิป' : ''}</small></span>
                    <b className={t.type === 'income' ? 'pos' : ''}>{t.type === 'income' ? '+' : ''}{t.amount.text}</b>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {data && (data.hasMore || page > 0) && (
        <div className="pager">
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← ใหม่กว่า</button>
          <button className="btn" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>เก่ากว่า →</button>
        </div>
      )}
    </>
  );
}

// ── BILLS ──
function BillsScreen({ version, refresh, toast, categories, me }: ScreenProps) {
  const { data, error } = useData<FixedCostItem[]>('/fixed-costs', version);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<{ occurrenceId: string; name: string; amount: string } | null>(null);

  async function act(fn: () => Promise<unknown>, okText: string) {
    try {
      await fn();
      toast(okText);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ไม่สำเร็จ');
    }
  }

  return (
    <>
      <button className="btn btn--primary btn--block" onClick={() => setAdding(true)}>＋ เพิ่มค่าใช้จ่ายประจำ</button>
      {!data ? <Loading error={error} /> : data.length === 0 ? (
        <div className="empty"><img src="/mascot/planning.png" alt="" width={110} height={110} /><p>ยังไม่มีค่าใช้จ่ายประจำ<br /><small className="muted">เช่น ค่าห้อง ค่าเน็ต ค่าผ่อน</small></p></div>
      ) : data.map((f) => (
        <section key={f.id} className={`card bill${f.status === 'paused' ? ' is-paused' : ''}`}>
          <div className="card__head">
            <h3>{f.category.emoji} {f.name}</h3>
            <b>{f.amount.text}</b>
          </div>
          <small className="muted">{f.status === 'paused' ? 'หยุดชั่วคราว' : f.schedule}</small>
          {[...f.overdue.map((o) => ({ ...o, status: 'overdue' })), ...(f.next?.occurrenceId ? [{ ...f.next, occurrenceId: f.next.occurrenceId }] : [])].map((o) => (
            <div key={o.occurrenceId} className="bill__due">
              <span className={o.status === 'overdue' ? 'neg' : ''}>{statusText(o.status, o.dueDate)}</span>
              <div className="bill__actions">
                <button className="chip" onClick={() => act(() => api(`/occurrences/${o.occurrenceId}/skip`, { method: 'POST' }), 'ข้ามงวดนี้แล้ว')}>ข้าม</button>
                <button className="chip chip--primary" onClick={() => setPaying({ occurrenceId: o.occurrenceId, name: f.name, amount: (o.amount.satang / 100).toFixed(2).replace(/\.00$/, '') })}>จ่ายแล้ว</button>
              </div>
            </div>
          ))}
          {!f.next && f.status === 'active' && f.overdue.length === 0 && <small className="muted">ยังไม่มีงวดถัดไป</small>}
          <div className="bill__foot">
            {f.status === 'active'
              ? <button className="link" onClick={() => act(() => api(`/fixed-costs/${f.id}/pause`, { method: 'POST' }), 'หยุดชั่วคราวแล้ว')}>⏸ หยุดชั่วคราว</button>
              : <button className="link" onClick={() => act(() => api(`/fixed-costs/${f.id}/resume`, { method: 'POST' }), 'เริ่มใหม่แล้ว')}>▶️ เริ่มใหม่</button>}
            <ConfirmButton label="🗑️ ลบ" confirmLabel="ยืนยันลบ" onConfirm={() => act(() => api(`/fixed-costs/${f.id}`, { method: 'DELETE' }), 'ลบแล้ว')} />
          </div>
        </section>
      ))}

      <PaySheet target={paying} onClose={() => setPaying(null)} onPay={(id, amount) => act(() => api(`/occurrences/${id}/pay`, { method: 'POST', body: { amount } }), 'บันทึกการจ่ายแล้ว ✅')} />
      <FixedCostSheet open={adding} onClose={() => setAdding(false)} categories={categories} today={me.today} onCreate={(b) => act(() => api('/fixed-costs', { method: 'POST', body: b }), 'เพิ่มแล้ว 📅')} />
    </>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return <button className={`link${armed ? ' neg' : ''}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? confirmLabel : label}</button>;
}

function PaySheet({ target, onClose, onPay }: { target: { occurrenceId: string; name: string; amount: string } | null; onClose: () => void; onPay: (id: string, amount: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  useEffect(() => setAmount(target?.amount ?? ''), [target]);
  return (
    <Sheet open={!!target} onClose={onClose} title={`จ่าย ${target?.name ?? ''}`}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (target) { await onPay(target.occurrenceId, amount); onClose(); } }}>
        <label className="field field--amount"><span>ยอดที่จ่ายจริง (บาท)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <p className="muted small">บันทึกเป็นรายจ่ายวันนี้ และบิลนี้จะไม่ถูกหักซ้ำ</p>
        <button className="btn btn--primary btn--block">✅ ยืนยันจ่าย</button>
      </form>
    </Sheet>
  );
}

function FixedCostSheet({ open, onClose, categories, today, onCreate }: { open: boolean; onClose: () => void; categories: Category[]; today: string; onCreate: (b: object) => Promise<void> }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'yearly' | 'custom'>('monthly');
  const [interval, setInterval_] = useState(1);
  const [firstDueDate, setFirst] = useState(today);
  const [categoryId, setCategoryId] = useState('bills');
  useEffect(() => { if (open) { setName(''); setAmount(''); setFrequency('monthly'); setInterval_(1); setFirst(today); setCategoryId('bills'); } }, [open, today]);
  const unit = { monthly: 'เดือน', weekly: 'สัปดาห์', yearly: 'ปี', custom: 'วัน' }[frequency];
  return (
    <Sheet open={open} onClose={onClose} title="เพิ่มค่าใช้จ่ายประจำ">
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onCreate({ name, amount, frequency, interval, firstDueDate, categoryId }); onClose(); }}>
        <label className="field"><span>ชื่อ</span><input required maxLength={60} placeholder="เช่น ค่าห้อง" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field field--amount"><span>ยอดต่องวด (บาท)</span><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="field">
          <span>ความถี่</span>
          <div className="seg seg--4">
            {(['monthly', 'weekly', 'yearly', 'custom'] as const).map((f) => (
              <button type="button" key={f} className={frequency === f ? 'is-on' : ''} onClick={() => setFrequency(f)}>{{ monthly: 'รายเดือน', weekly: 'รายสัปดาห์', yearly: 'รายปี', custom: 'ทุก N วัน' }[f]}</button>
            ))}
          </div>
        </div>
        <label className="field"><span>ทุกกี่{unit}</span><input type="number" min={1} max={366} value={interval} onChange={(e) => setInterval_(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="field"><span>ครบกำหนดครั้งแรก</span><input type="date" min={today} value={firstDueDate} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="field"><span>หมวด</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
        </label>
        <button className="btn btn--primary btn--block">✅ เพิ่ม</button>
      </form>
    </Sheet>
  );
}

// ── BUDGETS & GOALS ──
function PlansScreen({ version, refresh, toast, categories }: ScreenProps) {
  const { data: b } = useData<{ period: { start: string; end: string }; items: BudgetItem[] }>('/budgets', version);
  const { data: goals } = useData<GoalItem[]>('/goals', version);
  const [budgetSheet, setBudgetSheet] = useState(false);
  const [goalSheet, setGoalSheet] = useState(false);
  const [contrib, setContrib] = useState<GoalItem | null>(null);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast(ok); refresh(); } catch (e) { toast(e instanceof Error ? e.message : 'ไม่สำเร็จ'); }
  }

  return (
    <>
      <section className="card">
        <div className="card__head"><h3>งบประมาณ</h3><button className="link" onClick={() => setBudgetSheet(true)}>＋ ตั้งงบ</button></div>
        {!b ? <Loading /> : b.items.length === 0 ? <p className="muted">ยังไม่ได้ตั้งงบ ลองตั้งงบอาหารเดือนละ 6,000 ดูไหม</p> : (
          <ul className="budgets">
            {b.items.map((i) => (
              <li key={i.id}>
                <div className="catbars__row"><span>{i.category.emoji} {i.category.label}</span><b className={i.level === 'exceeded' ? 'neg' : ''}>{i.percent}%</b></div>
                <Progress percent={i.percent} level={i.level} />
                <div className="catbars__row small">
                  <span className="muted">{i.spent.text} / {i.limit.text}</span>
                  <ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={() => act(() => api(`/budgets/${i.id}`, { method: 'DELETE' }), 'ลบงบแล้ว')} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card__head"><h3>เป้าหมายออม</h3><button className="link" onClick={() => setGoalSheet(true)}>＋ ตั้งเป้า</button></div>
        {!goals ? <Loading /> : goals.length === 0 ? (
          <div className="empty empty--inline"><img src="/mascot/saving.png" alt="" width={72} height={72} /><p className="muted">ตั้งเป้าแล้วชิกชิกจะกันเงินออมไว้ให้ก่อน</p></div>
        ) : goals.map((g) => (
          <div key={g.id} className="goal">
            <div className="catbars__row"><b>🎯 {g.name}</b><b>{g.progressPercent}%</b></div>
            <Progress percent={g.progressPercent} level="goal" />
            <div className="catbars__row small">
              <span className="muted">{g.saved.text} / {g.target.text}{g.periodsToGoal ? ` · อีกราว ${g.periodsToGoal} เดือน` : ''}{g.isReached ? ' · ถึงเป้าแล้ว 🎉' : ''}</span>
              <span>
                <button className="chip chip--primary" onClick={() => setContrib(g)}>🐷 ออม</button>{' '}
                <ConfirmButton label="เก็บ" confirmLabel="ยืนยัน" onConfirm={() => act(() => api(`/goals/${g.id}/archive`, { method: 'POST' }), 'เก็บเข้ากรุแล้ว')} />
              </span>
            </div>
          </div>
        ))}
      </section>

      <AmountSheet
        open={budgetSheet}
        title="ตั้งงบรายเดือน"
        withCategory={[{ id: 'total', label: 'งบรวมทั้งเดือน', emoji: '🧺', kind: 'expense' }, ...categories.filter((c) => c.kind === 'expense')]}
        onClose={() => setBudgetSheet(false)}
        onSubmit={(amount, cat) => act(() => api(`/budgets/${cat}`, { method: 'PUT', body: { limit: amount } }), 'ตั้งงบแล้ว ✓')}
      />
      <AmountSheet open={!!contrib} title={`ออมเข้า ${contrib?.name ?? ''}`} onClose={() => setContrib(null)} onSubmit={(amount) => act(() => api(`/goals/${contrib!.id}/contribute`, { method: 'POST', body: { amount } }), 'ออมแล้ว 🐷')} />
      <GoalSheet open={goalSheet} onClose={() => setGoalSheet(false)} onCreate={(body) => act(() => api('/goals', { method: 'POST', body }), 'ตั้งเป้าแล้ว 💪')} />
    </>
  );
}

function AmountSheet({ open, title, onClose, onSubmit, withCategory }: { open: boolean; title: string; onClose: () => void; onSubmit: (amount: string, cat: string) => Promise<void>; withCategory?: Category[] }) {
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('total');
  useEffect(() => { if (open) { setAmount(''); setCat('total'); } }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onSubmit(amount, cat); onClose(); }}>
        {withCategory && (
          <label className="field"><span>หมวด</span>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>{withCategory.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}</select>
          </label>
        )}
        <label className="field field--amount"><span>จำนวนเงิน (บาท)</span><input required autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <button className="btn btn--primary btn--block">✅ บันทึก</button>
      </form>
    </Sheet>
  );
}

function GoalSheet({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (b: object) => Promise<void> }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');
  useEffect(() => { if (open) { setName(''); setTarget(''); setMonthly(''); } }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="ตั้งเป้าหมายออม">
      <form className="form" onSubmit={async (e) => { e.preventDefault(); await onCreate({ name, target, ...(monthly ? { monthlyReserve: monthly } : {}) }); onClose(); }}>
        <label className="field"><span>ชื่อเป้าหมาย</span><input required maxLength={60} placeholder="เช่น เที่ยวญี่ปุ่น" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field field--amount"><span>ยอดเป้าหมาย (บาท)</span><input required inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className="field"><span>กันไว้ออมต่อเดือน (ไม่บังคับ)</span><input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
        <button className="btn btn--primary btn--block">✅ ตั้งเป้า</button>
      </form>
    </Sheet>
  );
}

// ── SETTINGS ──
function SettingsScreen({ me, toast, onSaved }: ScreenProps & { onSaved: (m: Me) => void }) {
  const labels: Record<keyof Me['notifications'], string> = {
    dailySummary: 'สรุปรายวัน (21:00)',
    weeklySummary: 'สรุปรายสัปดาห์ (อา. 20:00)',
    monthlySummary: 'สรุปสิ้นรอบเดือน',
    billReminders: 'เตือนบิล (08:00)',
    budgetAlerts: 'เตือนเมื่อใกล้เกินงบ',
  };
  async function save(patch: object) {
    try {
      const r = await api<Pick<Me, 'cycleStartDay' | 'notifications'>>('/settings', { method: 'PATCH', body: patch });
      onSaved({ ...me, ...r });
      toast('บันทึกแล้ว ✓');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'ไม่สำเร็จ');
    }
  }
  return (
    <>
      <section className="card">
        <h3>การแจ้งเตือน</h3>
        <ul className="toggles">
          {(Object.keys(labels) as Array<keyof Me['notifications']>).map((k) => (
            <li key={k}>
              <label>
                <span>{labels[k]}</span>
                <input type="checkbox" role="switch" checked={me.notifications[k]} onChange={(e) => save({ notifications: { [k]: e.target.checked } })} />
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>รอบเดือน</h3>
        <label className="field">
          <span>เริ่มรอบวันที่</span>
          <select value={me.cycleStartDay} onChange={(e) => save({ cycleStartDay: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}{d === 1 ? ' (ตามปฏิทิน)' : ''}</option>)}
          </select>
        </label>
        <p className="muted small">ถ้าเงินเดือนออกวันที่ 25 แนะนำให้ตั้งเป็น 25</p>
      </section>
      <section className="card">
        <h3>ข้อมูลของคุณ</h3>
        <p className="muted small">ส่งออกหรือลบข้อมูลทั้งหมดได้ในแชท LINE: พิมพ์ "ส่งออกข้อมูล" หรือ "ลบข้อมูล"</p>
      </section>
    </>
  );
}
