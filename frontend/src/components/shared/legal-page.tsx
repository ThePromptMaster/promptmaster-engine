'use client';

import Link from 'next/link';

/** The plain frame the privacy and terms pages share. English only, as written for review. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--surface)]" lang="en" dir="ltr">
      <header className="bg-[var(--surface-container-lowest)]">
        <div className="flex items-center gap-2.5 px-4 py-3 sm:px-6 md:px-10">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" aria-hidden className="h-7 w-7 rounded-lg" />
            <span className="text-title tracking-tight text-[var(--on-surface)]">PromptMaster</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12 [&_h2]:mt-8 [&_h2]:text-headline [&_h2]:text-[var(--on-surface)] [&_li]:mt-1 [&_p]:mt-3 [&_p]:text-body [&_p]:text-[var(--on-surface)] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ul]:text-body [&_ul]:text-[var(--on-surface)]">
        <h1 className="text-display text-[var(--on-surface)]">{title}</h1>
        <p className="!mt-2 !text-[var(--on-surface-variant)]">Last updated {updated}</p>
        {children}
      </main>
    </div>
  );
}

/** Where to write to us, once the deployment has an address to give. */
export function ContactLine() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return email ? (
    <a href={`mailto:${email}`} className="font-medium text-[var(--pm-primary)] hover:underline">{email}</a>
  ) : (
    <>the feedback form in the app</>
  );
}
