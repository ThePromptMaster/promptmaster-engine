'use client';

import { ConnectFlow } from '@/components/personalize/connect-flow';
import { useConnectionsAllowed } from '@/components/personalize/use-connections-allowed';
import { ExampleQuestionnaire } from '@/components/examples/example-questionnaire';
import { useT } from '@/lib/i18n/i18n-provider';

export default function ConnectPage() {
  const t = useT();
  const allowed = useConnectionsAllowed();
  if (allowed === null) return null;
  if (allowed) return <ConnectFlow />;
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-headline text-[var(--on-surface)]">{t('conn.title')}</h1>
      <p className="mt-2 text-body text-[var(--on-surface-variant)]">{t('conn.notOffered')}</p>
      <div className="mt-5">
        <ExampleQuestionnaire startOpen />
      </div>
    </main>
  );
}
