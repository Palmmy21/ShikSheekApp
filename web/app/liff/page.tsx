'use client';
import dynamic from 'next/dynamic';
import './liff.css';

// LIFF needs `window`; render only in the browser.
const LiffApp = dynamic(() => import('@/components/liff/LiffApp'), {
  ssr: false,
  loading: () => (
    <div className="lf-splash">
      <img src="/mascot/happy.png" alt="" width={120} height={120} />
      <p>ชิกชิกกำลังเปิดสมุดบัญชี…</p>
    </div>
  ),
});

export default function LiffPage() {
  return <LiffApp />;
}
