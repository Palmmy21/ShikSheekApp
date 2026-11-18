import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'ShikSheek — สมุดบัญชีของฉัน',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#E93636', width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' };

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
