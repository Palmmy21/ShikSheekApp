import type { Metadata, Viewport } from 'next';
import { Anuphan, Prompt } from 'next/font/google';
import './globals.css';

const display = Prompt({ subsets: ['thai', 'latin'], weight: ['500', '600', '700', '800'], variable: '--font-display', display: 'swap' });
const body = Anuphan({ subsets: ['thai', 'latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shiksheek.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'ShikSheek ชิกชิก — ผู้ช่วยการเงินบน LINE ที่คุยรู้เรื่อง',
  description:
    'จดรายรับรายจ่ายแค่พิมพ์ "กินข้าว 65" รู้ยอดใช้ได้จริงหลังหักบิลและเงินออม เตือนบิลก่อนครบกำหนด สรุปทุกวัน ทั้งหมดใน LINE กับไก่ชิกชิก',
  openGraph: {
    title: 'ShikSheek — ให้เรื่องเงินเป็นเรื่องชิกชิก!',
    description: 'ผู้ช่วยการเงินบน LINE: จดด้วยภาษาพูด รู้ยอดใช้ได้จริง ไม่พลาดบิล',
    images: ['/og.png'],
    locale: 'th_TH',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
  icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#E93636', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
