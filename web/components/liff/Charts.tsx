'use client';
/**
 * Single-series charts (one brand hue → no legend; the title names the series).
 * Daily bars: 4px rounded data-ends anchored to the baseline, 2px gaps, recessive axis, per-bar
 * hover/tap tooltip with hit targets wider than the marks, and a table view for accessibility.
 */
import { useState } from 'react';
import type { CategoryRef, Money } from '@/lib/liff-api';
import { thaiDate } from '@/lib/liff-api';
import { CategoryIcon } from '@/components/icons';

export function DailyBars({ data, today }: { data: Array<{ date: string; expense: Money }>; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.expense.satang));
  const W = 320;
  const H = 120;
  const gap = 2;
  const bw = Math.max(2, (W - gap * (data.length - 1)) / data.length);
  const peak = data.reduce((best, d, i) => (d.expense.satang > (data[best]?.expense.satang ?? 0) ? i : best), 0);
  const shown = active ?? (data[peak]?.expense.satang ? peak : null);

  return (
    <figure className="chart">
      <div className="chart__head">
        <figcaption>ใช้จ่ายรายวัน</figcaption>
        <button className="chip chip--ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'ดูกราฟ' : 'ดูเป็นตาราง'}
        </button>
      </div>
      {table ? (
        <table className="chart__table">
          <thead>
            <tr><th>วันที่</th><th>ใช้ไป</th></tr>
          </thead>
          <tbody>
            {data.filter((d) => d.expense.satang > 0).map((d) => (
              <tr key={d.date}><td>{thaiDate(d.date)}</td><td>{d.expense.text}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="chart__tip" aria-live="polite">
            {shown !== null && data[shown] ? (
              <>
                <b>{data[shown]!.expense.text}</b> <span>{thaiDate(data[shown]!.date)}{active === null ? ' · วันที่ใช้มากสุด' : ''}</span>
              </>
            ) : (
              <span>ยังไม่มีรายจ่ายในรอบนี้</span>
            )}
          </div>
          <svg viewBox={`0 0 ${W} ${H + 16}`} className="chart__svg" role="img" aria-label="กราฟแท่งรายจ่ายรายวัน" onMouseLeave={() => setActive(null)}>
            <line x1="0" x2={W} y1={H} y2={H} className="chart__axis" />
            {data.map((d, i) => {
              const h = d.expense.satang > 0 ? Math.max(3, (d.expense.satang / max) * (H - 8)) : 0;
              const x = i * (bw + gap);
              const r = Math.min(4, bw / 2, h);
              const isToday = d.date === today;
              const future = d.date > today;
              return (
                <g key={d.date}>
                  {h > 0 && (
                    <path
                      d={`M${x},${H} V${H - h + r} Q${x},${H - h} ${x + r},${H - h} H${x + bw - r} Q${x + bw},${H - h} ${x + bw},${H - h + r} V${H} Z`}
                      className={`chart__bar${shown === i ? ' is-active' : ''}${isToday ? ' is-today' : ''}`}
                    />
                  )}
                  {future && <rect x={x} y={H - 2} width={bw} height={2} className="chart__future" />}
                  {/* hit target: full column, wider than the mark */}
                  <rect
                    x={x - gap / 2}
                    y={0}
                    width={bw + gap}
                    height={H + 16}
                    fill="transparent"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => setActive(i)}
                    aria-label={`${thaiDate(d.date)} ${d.expense.text}`}
                  />
                </g>
              );
            })}
            <text x="0" y={H + 13} className="chart__label">{thaiDate(data[0]?.date ?? today)}</text>
            <text x={W} y={H + 13} textAnchor="end" className="chart__label">{thaiDate(data.at(-1)?.date ?? today)}</text>
          </svg>
        </>
      )}
    </figure>
  );
}

export function CategoryBars({ items, total }: { items: Array<CategoryRef & { amount: Money; count?: number }>; total: number }) {
  if (!items.length) return <p className="muted">ยังไม่มีรายจ่ายในรอบนี้</p>;
  const max = Math.max(1, ...items.map((i) => i.amount.satang));
  return (
    <ul className="catbars">
      {items.map((c) => (
        <li key={c.id}>
          <div className="catbars__row">
            <CategoryIcon id={c.id} size={30} />
            <span className="catbars__label">{c.label}</span>
            <b>{c.amount.text}</b>
          </div>
          <div className="catbars__track" title={`${c.label} ${c.amount.text}`}>
            <div className="catbars__fill" style={{ width: `${Math.max(2, (c.amount.satang / max) * 100)}%` }} />
          </div>
          <small className="muted">{total > 0 ? Math.round((c.amount.satang / total) * 100) : 0}% ของรายจ่าย{c.count ? ` · ${c.count} รายการ` : ''}</small>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ percent, level }: { percent: number; level: 'ok' | 'warning' | 'exceeded' | 'goal' }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress__fill progress__fill--${level}`} style={{ width: `${Math.min(100, Math.max(percent > 0 ? 3 : 0, percent))}%` }} />
    </div>
  );
}
