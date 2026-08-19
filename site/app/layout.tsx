import type { Metadata } from 'next';
import { Azeret_Mono, Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google';
import { SITE } from '@/lib/site';
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

const DESCRIPTION =
  'Persistent memory and a real code graph for Claude Code. It remembers the decisions you already explained, and answers what breaks if you change something.';

export const metadata: Metadata = {
  title: {
    default: 'claude-db',
    template: '%s | claude-db',
  },
  description: DESCRIPTION,
  metadataBase: new URL(SITE),
  applicationName: 'claude-db',
  keywords: [
    'Claude Code',
    'persistent memory',
    'code graph',
    'MCP server',
    'developer tools',
    'SQLite',
  ],
  authors: [{ name: 'Avijit Dey', url: 'https://github.com/Avijit07x' }],
  creator: 'Avijit Dey',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'claude-db',
    description: 'Stop paying Claude to relearn your own repo.',
    url: SITE,
    siteName: 'claude-db',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'claude-db',
    description: 'Stop paying Claude to relearn your own repo.',
  },
  icons: { icon: '/logo.svg', apple: '/logo.svg' },
};

const SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'claude-db',
  description: DESCRIPTION,
  url: SITE,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux, Windows',
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
  author: { '@type': 'Person', name: 'Avijit Dey' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body className="font-sans text-base leading-relaxed">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA) }}
        />
        {children}
      </body>
    </html>
  );
}
