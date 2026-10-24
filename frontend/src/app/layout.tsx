import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { BetaNotice } from '@/components/shared/beta-notice';
import { ApplyColourPreferences } from '@/components/shared/colour-preferences';
import { I18nProvider } from '@/lib/i18n/i18n-provider';
import { prePaintScript } from '@/lib/appearance/colours';

/** The user's colours, set before the first paint (22 Oct). */
const PRE_PAINT = prePaintScript();
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'PromptMaster',
    template: '%s | PromptMaster',
  },
  description:
    'A system for thinking with AI. Get clearer, more precise results by structuring how you interact with AI — using modes, evaluation, and iterative refinement.',
  keywords: [
    'prompt engineering',
    'AI workflow',
    'LLM',
    'structured prompting',
    'evaluation',
    'alignment',
    'drift detection',
    'PromptMaster',
  ],
  authors: [{ name: 'PromptMaster' }],
  openGraph: {
    type: 'website',
    title: 'PromptMaster',
    description:
      'A system for thinking with AI. Get clearer, more precise results by structuring how you interact with AI.',
    siteName: 'PromptMaster',
  },
  twitter: {
    card: 'summary',
    title: 'PromptMaster',
    description:
      'A system for thinking with AI. Get clearer, more precise results by structuring how you interact with AI.',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/logo.svg',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The colour script below sets styles on <html> before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
        {/* display=block, not swap: an icon font's fallback is its ligature
            names, so "swap" flashed "arrow_back" and "science" as text on
            every first load. Next's lint rule targets text fonts, where swap
            is right; for an icon font it is the cause of the flash. */}
        {/* eslint-disable-next-line @next/next/google-font-display */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-[var(--surface)] text-[var(--on-surface)] min-h-screen">
        {/* The interface language (client, 21 Oct). The root stays static, so
            it renders English and the browser's choice takes over; signed-in
            pages read the cookie in their own layout and render it at once. */}
        <I18nProvider>
          {/* FR-22: the beta notice is global — every route has to carry it. */}
          <BetaNotice />
          <ApplyColourPreferences />
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
