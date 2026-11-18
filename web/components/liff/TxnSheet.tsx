'use client';
/** Bottom sheet for adding or editing a transaction. Amount is sent as text and parsed exactly server-side. */
import { useEffect, useMemo, useState } from 'react';
import type { Category, Txn } from '@/lib/liff-api';

export interface TxnInput {
  type: 'income' | 'expense';
  amount: string;
  categoryId: string;
  note: string;
  date: string;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet__backdrop" aria-label="ปิด" onClick={onClose} />
      <div className="sheet__panel">
        <div className="sheet__grab" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function TxnSheet({
  open, onClose, categories, today, editing, onSubmit, onDelete,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  today: string;
  editing: Txn | null;
  onSubmit: (input: TxnInput) => Promise<void>;
  onDelete?: (t: Txn) => Promise<void>;
}) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing && editing.type !== 'saving') {
      setType(editing.type);
      setAmount((editing.amount.satang / 100).toFixed(2).replace(/\.00$/, ''));
      setCategoryId(editing.category.id);
      setNote(editing.note ?? '');
      setDate(editing.date);
    } else {
      setType('expense');
      setAmount('');
      setCategoryId('food');
      setNote('');
      setDate(today);
    }
  }, [open, editing, today]);

  const cats = useMemo(() => categories.filter((c) => c.kind === type), [categories, type]);
  useEffect(() => {
    if (!cats.some((c) => c.id === categoryId) && cats[0]) setCategoryId(cats[0].id);
  }, [cats, categoryId]);

  const validAmount = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(amount.trim()) && Number(amount.replace(/,/g, '')) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validAmount) return setError('ใส่จำนวนเงินให้ถูกต้อง เช่น 65 หรือ 1,250.50');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ type, amount: amount.trim(), categoryId, note: note.trim(), date });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'แก้ไขรายการ' : 'จดรายการใหม่'}>
      <form onSubmit={submit} className="form">
        {!editing?.isBillPayment && (
          <div className="seg" role="radiogroup" aria-label="ประเภท">
            <button type="button" role="radio" aria-checked={type === 'expense'} className={type === 'expense' ? 'is-on' : ''} onClick={() => setType('expense')}>รายจ่าย</button>
            <button type="button" role="radio" aria-checked={type === 'income'} className={type === 'income' ? 'is-on is-income' : ''} onClick={() => setType('income')}>รายรับ</button>
          </div>
        )}
        <label className="field field--amount">
          <span>จำนวนเงิน (บาท)</span>
          <input inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== '' && !validAmount} />
        </label>
        <div className="field">
          <span>หมวด</span>
          <div className="catgrid">
            {cats.map((c) => (
              <button type="button" key={c.id} className={`catpick${categoryId === c.id ? ' is-on' : ''}`} onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id}>
                <span aria-hidden="true">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>โน้ต</span>
          <input maxLength={100} placeholder="เช่น ข้าวมันไก่" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          <span>วันที่</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        {error && <p className="form__error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : '✅ บันทึก'}</button>
        {editing && onDelete && (
          <button type="button" className="btn btn--danger-ghost btn--block" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(editing); onClose(); } finally { setBusy(false); } }}>
            🗑️ ลบรายการนี้
          </button>
        )}
      </form>
    </Sheet>
  );
}
