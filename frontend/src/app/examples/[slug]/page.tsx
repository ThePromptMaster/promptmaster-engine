'use client';

import { useParams } from 'next/navigation';

import { ExampleCards } from '@/components/examples/example-cards';
import { ExamplePreview } from '@/components/examples/example-preview';
import { useT } from '@/lib/i18n/i18n-provider';
import { exampleBySlug } from '@/lib/projects/examples';

export default function ExamplePage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const example = exampleBySlug(slug);
  if (example) return <ExamplePreview example={example} />;
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-headline text-[var(--on-surface)]">{t('ex.notFoundTitle')}</h1>
      <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('ex.notFoundBody')}</p>
      <div className="mt-6">
        <ExampleCards />
      </div>
    </main>
  );
}
