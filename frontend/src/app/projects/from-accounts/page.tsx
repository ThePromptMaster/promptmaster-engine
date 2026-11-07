'use client';

import { useSyncExternalStore } from 'react';

import { ConnectFlow } from '@/components/personalize/connect-flow';

const noSubscription = () => () => undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Use my mail, calendar and files" (7 Nov). `?for=briefing` when it was opened to
 * prepare for a meeting; `?into=<project id>` when a project's panel opened it to add
 * to that project.
 */
export default function FromAccountsPage() {
  const search = useSyncExternalStore(noSubscription, () => window.location.search, () => '');
  const params = new URLSearchParams(search);
  const into = params.get('into') ?? '';
  return <ConnectFlow briefing={params.get('for') === 'briefing'} into={UUID.test(into) ? into : undefined} />;
}
