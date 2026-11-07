'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api/client';
import { takeReturn, toolkitLabel } from '@/lib/connections/items';
import { useT } from '@/lib/i18n/i18n-provider';

type State =
  | { kind: 'working' }
  | { kind: 'done'; name: string; next: string }
  | { kind: 'refused'; next: string }
  | { kind: 'unchecked'; why: string; next: string };

/**
 * Where Composio sends the person back after Google's or Microsoft's screen.
 *
 * Its query says success or failure and names the new connection, but a query
 * is not proof (Composio's own advice), so the backend confirms the connection
 * exists and is this person's before anything treats it as connected. Runs once:
 * the remembered return path is taken, and a second run would lose it.
 */
export default function ConnectReturnPage() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('connected_account_id') ?? '';
    const next = takeReturn();
    const confirmed = params.get('status') === 'success' && id ? api.confirmConnection(id) : Promise.resolve(null);
    confirmed
      .then((connection) => {
        if (!connection || connection.status !== 'ACTIVE') {
          setState({ kind: 'refused', next });
          return;
        }
        setState({ kind: 'done', name: toolkitLabel(connection.toolkit), next });
        window.setTimeout(() => window.location.replace(next), 1200);
      })
      .catch((e: unknown) => setState({ kind: 'unchecked', why: e instanceof Error ? e.message : '', next }));
  }, []);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-12 sm:px-6">
      {state.kind === 'working' && <p role="status" className="text-body text-[var(--on-surface-variant)]">{t('conn.finishing')}</p>}
      {state.kind === 'done' && <p role="status" className="text-title text-[var(--on-surface)]">{t('conn.finished', { name: state.name })}</p>}
      {(state.kind === 'refused' || state.kind === 'unchecked') && (
        <>
          <p role="alert" className="text-body text-[var(--on-surface)]">
            {state.kind === 'refused' ? t('conn.refused') : t('conn.confirmFailed', { why: state.why })}
          </p>
          <Link
            href={state.next}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--surface-container-high)] px-5 py-3 text-title text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
          >
            {t('conn.continue')}
          </Link>
        </>
      )}
    </main>
  );
}
