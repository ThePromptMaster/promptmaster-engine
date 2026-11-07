'use client';

import { useSyncExternalStore } from 'react';

import { ConnectFlow } from '@/components/personalize/connect-flow';

const noSubscription = () => () => undefined;

/** "Use my mail, calendar and files" (7 Nov). `?for=briefing` when it was opened to prepare for a meeting. */
export default function FromAccountsPage() {
  const briefing = useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(window.location.search).get('for') === 'briefing',
    () => false
  );
  return <ConnectFlow briefing={briefing} />;
}
