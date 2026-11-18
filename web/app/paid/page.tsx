import type { Metadata } from 'next';
import '../legal.css';

export const metadata: Metadata = { title: 'ชำระเงินเรียบร้อย — ShikSheek', robots: { index: false, follow: false } };

const LINE_CHAT = 'https://line.me/R/ti/p/%40541ywsff';

/** 2C2P redirects here after the PromptPay page. The plan is granted server-side, never from this page. */
export default function Paid() {
  return (
    <main className="legal legal--center">
      <img src="/mascot/celebrating.png" alt="" width={160} height={160} />
      <h1>ขอบคุณที่สนับสนุนชิกชิก!</h1>
      <p>ถ้าสแกนจ่ายเรียบร้อยแล้ว ชิกชิกจะส่งข้อความยืนยันในแชท LINE ภายในไม่กี่วินาที</p>
      <p className="muted">ยังไม่เห็นข้อความ? กลับไปที่แชทแล้วกด &ldquo;จ่ายแล้ว ตรวจสอบ&rdquo; ได้เลย</p>
      <a className="btn-line" href={LINE_CHAT}>กลับไปที่แชท LINE</a>
    </main>
  );
}
