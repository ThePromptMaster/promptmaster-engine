import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { BetaNotice } from '@/components/shared/beta-notice';
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
    <html lang="en" className={inter.variable}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-[var(--surface)] text-[var(--on-surface)] min-h-screen">
        {/* FR-22: the beta notice is global — every route has to carry it. */}
        <BetaNotice />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
