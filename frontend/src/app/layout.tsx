import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/api/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'MonEdu — 공부 시간 기록',
  description: '웹캠 기반 학습 모니터링. 영상은 브라우저 안에서만 분석되며 저장·전송되지 않습니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1d1e22' },
  ],
};

/** Applies the saved theme before first paint (no light flash in dark mode). Mirrors components/theme.ts. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('sm.theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-white text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
