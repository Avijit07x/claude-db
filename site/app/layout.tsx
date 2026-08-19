import type { Metadata } from 'next';
import { Azeret_Mono, Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

const mono = Azeret_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono-code',
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'claude-db',
  description:
    'Persistent memory and a real code graph for Claude Code. It remembers the decisions you already explained, and answers what breaks if you change something.',
  metadataBase: new URL('https://claude-db.vercel.app'),
  openGraph: {
    title: 'claude-db',
    description: 'Stop paying Claude to relearn your own repo.',
    type: 'website',
  },
  icons: { icon: '/logo.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body className="font-sans text-base leading-relaxed">{children}</body>
    </html>
  );
}
