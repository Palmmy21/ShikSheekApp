'use client';
/**
 * "การ์ดสตอรี่" — swipe through this month's cards, hide amounts if you like, then hand the PNG to
 * the phone's share sheet (pick Instagram → Story). Where the in-app browser can't share files we
 * show the image to long-press-save, plus a download link and an "open in browser" escape hatch.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, ExternalLink, Share2, X } from 'lucide-react';
import { api, inLineClient, openExternal, type StoryDeck } from '@/lib/liff-api';
import { canShareFiles, canvasToFile, renderStoryCard } from '@/lib/story-card';

interface Rendered {
  url: string;
  file: File;
}

export function StoryStudio({ onClose, toast }: { onClose: () => void; toast: (text: string) => void }) {
  const [deck, setDeck] = useState<StoryDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hide, setHide] = useState(true);
  const [index, setIndex] = useState(0);
  const [rendered, setRendered] = useState<Array<Rendered | null>>([]);
  const [saveHint, setSaveHint] = useState(false);
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<StoryDeck>('/story').then(setDeck).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Pre-render every card (and re-render on the privacy toggle) so tapping "share" calls
  // navigator.share synchronously — Safari drops the share if we await rendering first.
  useEffect(() => {
    if (!deck) return;
    let alive = true;
    const urls: string[] = [];
    setRendered(deck.cards.map(() => null));
    (async () => {
      for (const [i, card] of deck.cards.entries()) {
        const canvas = await renderStoryCard(deck, card, { hideAmounts: hide });
        const file = await canvasToFile(canvas, `shiksheek-${card.kind}-${deck.period.start.slice(0, 7)}.png`);
        const url = URL.createObjectURL(file);
        urls.push(url);
        if (!alive) return;
        setRendered((r) => r.map((x, j) => (j === i ? { url, file } : x)));
      }
    })().catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [deck, hide]);

  function onScroll() {
    const el = rail.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  }

  function goTo(i: number) {
    rail.current?.scrollTo({ left: i * rail.current.clientWidth, behavior: 'smooth' });
  }

  const card = deck?.cards[index];
  const current = rendered[index] ?? null;
  const shareable = current ? canShareFiles(current.file) : false;

  function track(method: 'share' | 'download') {
    if (card) void api('/story/shared', { method: 'POST', body: { card: card.kind, method } }).catch(() => {});
  }

  async function share() {
    if (!current || !card) return;
    if (!shareable) {
      setSaveHint(true);
      return;
    }
    try {
      await navigator.share({ files: [current.file], title: 'ชิกชิก', text: deck!.invite.line });
      track('share');
      toast('แชร์แล้ว ปังมาก 🔥');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') setSaveHint(true);
    }
  }

  function download() {
    if (!current) return;
    const a = document.createElement('a');
    a.href = current.url;
    a.download = current.file.name;
    a.click();
    track('download');
    setSaveHint(true);
  }

  return (
    <div className="story" role="dialog" aria-modal="true" aria-label="การ์ดสตอรี่">
      <header className="story__top">
        <div>
          <strong>การ์ดสตอรี่ของคุณ</strong>
          <small>{deck ? `${deck.periodLabel} · เลื่อนดู ${deck.cards.length} แบบ` : 'กำลังเตรียมการ์ด…'}</small>
        </div>
        <button className="story__close" onClick={onClose} aria-label="ปิด"><X size={22} /></button>
      </header>

      {error && <p className="story__error">{error}</p>}

      <div className="story__rail" ref={rail} onScroll={onScroll}>
        {(deck?.cards ?? [null]).map((c, i) => (
          <div className="story__slide" key={c?.kind ?? i}>
            {rendered[i] ? (
              <img src={rendered[i]!.url} alt={c ? `${c.title} — ${c.subtitle}` : ''} className="story__img" />
            ) : (
              <div className="story__img story__img--loading" aria-busy="true"><img src="/mascot/thinking.png" alt="" width={120} height={120} /></div>
            )}
          </div>
        ))}
      </div>

      {deck && deck.cards.length > 1 && (
        <div className="story__dots" role="tablist">
          {deck.cards.map((c, i) => (
            <button key={c.kind} role="tab" aria-selected={i === index} aria-label={c.title} className={i === index ? 'is-on' : ''} onClick={() => goTo(i)} />
          ))}
        </div>
      )}

      <div className="story__actions">
        <button className="story__toggle" onClick={() => setHide((h) => !h)} aria-pressed={hide}>
          {hide ? <EyeOff size={18} /> : <Eye size={18} />}
          {hide ? 'ซ่อนยอดเงินอยู่' : 'โชว์ยอดเงิน'}
        </button>
        <button className="btn btn--primary btn--block story__share" onClick={share} disabled={!current}>
          <Share2 size={20} /> แชร์ลงสตอรี่
        </button>
        <div className="story__row">
          <button className="btn btn--ghost" onClick={download} disabled={!current}><Download size={18} /> บันทึกรูป</button>
          {inLineClient() && !shareable && (
            <button className="btn btn--ghost" onClick={() => openExternal(`${window.location.origin}/liff/?tab=story`)}><ExternalLink size={18} /> เปิดในเบราว์เซอร์</button>
          )}
        </div>
        <p className="story__hint">
          {saveHint
            ? 'กดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ" จากนั้นเปิด IG → สตอรี่ → เลือกรูปนี้ได้เลย'
            : 'กดแชร์แล้วเลือก Instagram → สตอรี่ · รายรับไม่ขึ้นบนการ์ด ใครเห็นก็ไม่รู้เงินเดือน 😉'}
        </p>
      </div>
    </div>
  );
}
