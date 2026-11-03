import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/api/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Study Monitor — 학습 모니터링',
  description: '웹캠 기반 학습 모니터링. 영상은 브라우저 안에서만 분석되며 저장·전송되지 않습니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8fafc',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
