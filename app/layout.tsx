import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Яндекс Календарь',
  description: 'Просмотр календаря Яндекс 360 по неделям',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
