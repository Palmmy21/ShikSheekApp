'use client';
/**
 * น้องชีก, alive: breathes, leans toward the pointer, blinks, gets excited on hover, celebrates with
 * confetti when tapped, and gets ticklish if you keep poking. Respects prefers-reduced-motion
 * (no leaning/bobbing; expressions still change on tap).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Mood = 'encouraging' | 'happy' | 'excited' | 'celebrating' | 'shocked' | 'proud';
const ALL: Mood[] = ['encouraging', 'happy', 'excited', 'celebrating', 'shocked', 'proud'];
const LINES = ['จดเงินกับชิกชิกกัน!', 'วันนี้ใช้ไปเท่าไหร่น้า?', 'อย่าลืมเก็บเงินนะ 🐷', 'พิมพ์ "กินข้าว 65" ได้เลย', 'ชิกชิกจำให้หมดเลย!', 'บิลไม่พลาดแน่นอน 📅'];
const COLORS = ['#E93636', '#FFD447', '#2E9E6A', '#3A7BD5', '#F59AB5'];

interface Bit {
  id: number;
  x: number;
  y: number;
  r: number;
  c: string;
  s: number;
}

export function LiveMascot({ size = 168 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mood, setMood] = useState<Mood>('encouraging');
  const [hover, setHover] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [bits, setBits] = useState<Bit[]>([]);
  const pokes = useRef<number[]>([]);
  const timers = useRef<number[]>([]);
  const reduced = useRef(false);

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timers.current.push(t);
  };

  // preload every expression so swaps never flicker
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const m of ALL) {
      const img = new Image();
      img.src = `/mascot/${m}.png`;
    }
    return () => timers.current.forEach(clearTimeout);
  }, []);

  // occasional blink (the squinty-smile pose reads as a happy blink)
  useEffect(() => {
    const id = window.setInterval(() => {
      setMood((m) => {
        if (m !== 'encouraging') return m;
        later(() => setMood((cur) => (cur === 'happy' ? 'encouraging' : cur)), 220);
        return 'happy';
      });
    }, 3800 + Math.random() * 2400);
    return () => clearInterval(id);
  }, []);

  // lean toward the pointer (CSS variables, no re-render per frame)
  useEffect(() => {
    if (reduced.current) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
        const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        el.style.setProperty('--lean', `${Math.max(-1, Math.min(1, dx)) * 9}deg`);
        el.style.setProperty('--shift-x', `${Math.max(-1, Math.min(1, dx)) * 8}px`);
        el.style.setProperty('--shift-y', `${Math.max(-1, Math.min(1, dy)) * 5}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const burst = useCallback(() => {
    if (reduced.current) return;
    const now = Date.now();
    const fresh: Bit[] = Array.from({ length: 18 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
      const d = 70 + Math.random() * 60;
      return { id: now + i, x: Math.cos(a) * d, y: Math.sin(a) * d - 30, r: Math.random() * 360, c: COLORS[i % COLORS.length]!, s: 6 + Math.random() * 6 };
    });
    setBits((b) => [...b, ...fresh]);
    later(() => setBits((b) => b.filter((x) => x.id < now)), 900);
  }, []);

  function poke() {
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 2500), now];
    if (pokes.current.length >= 5) {
      pokes.current = [];
      setMood('shocked');
      setSay('จั๊กจี้น้า พอแล้วๆ 😆');
      later(() => setMood('encouraging'), 1400);
      later(() => setSay(null), 2200);
      return;
    }
    setMood('celebrating');
    setSay(LINES[Math.floor(Math.random() * LINES.length)]!);
    burst();
    later(() => setMood('encouraging'), 1100);
    later(() => setSay(null), 2400);
  }

  const shown: Mood = hover && mood === 'encouraging' ? 'excited' : mood;

  return (
    <div
      ref={ref}
      className={`live${hover ? ' is-hover' : ''}${mood === 'celebrating' ? ' is-party' : ''}${mood === 'shocked' ? ' is-shock' : ''}`}
      style={{ width: size, height: size }}
    >
      {say && (
        <div className="live__bubble" role="status">
          {say}
        </div>
      )}
      <button
        type="button"
        className="live__btn"
        aria-label="ลูบหัวน้องชีก"
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={poke}
      >
        <span className="live__body">
          <img src={`/mascot/${shown}.png`} alt="" width={size} height={size} draggable={false} />
        </span>
        <span className="live__shadow" aria-hidden="true" />
      </button>
      {bits.map((b) => (
        <span
          key={b.id}
          className="live__bit"
          aria-hidden="true"
          style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.r}deg`, background: b.c, width: b.s, height: b.s * 0.6 } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
