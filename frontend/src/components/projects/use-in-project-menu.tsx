'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { ProjectPicker } from '@/components/workflow/project-references';
import { useDismiss } from '@/components/projects/use-dismiss';
import { addReference } from '@/lib/supabase/references';
import type { ProjectFolder, ProjectSummary } from '@/types/project';

interface Props {
  source: ProjectSummary;
  userId: string;
  projects: readonly ProjectSummary[];
  folders: readonly ProjectFolder[];
}

/**
 * "Use in a project…" from a project's card (client, 21 Oct, email 5): the
 * chosen project draws on this one from then on, as it would after "Use
 * another project" inside it.
 */
export function UseInProjectMenu(props: Props) {
  const t = useT();
  const { source } = props;
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('useIn.button', { name: source.title || t('useIn.thisProject') })}
        title={t('useIn.title')}
        className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
      >
        <span className="material-symbols-outlined text-[20px]">link</span>
      </button>
      {open && (
        <div role="dialog" aria-label={t('useIn.dialog')} className="absolute end-0 top-full z-20 mt-1 w-[300px] rounded-xl bg-[var(--surface-container-lowest)] p-3 shadow-[0_1px_2px_rgba(25,28,30,0.06),0_12px_28px_-12px_rgba(25,28,30,0.3)]">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <UseInProjectPanel {...props} />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('card.close')}
              className="-me-1 -mt-1 rounded-lg p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The question and the list of projects, in the popover on a computer and the sheet on a phone. */
export function UseInProjectPanel({ source, userId, projects, folders }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = async (targetId: string) => {
    setBusy(true);
    setSaid(null);
    const target = projects.find((p) => p.id === targetId);
    try {
      await addReference(userId, targetId, source.id);
      setSaid({ ok: true, text: t('useIn.done', { name: target?.title || t('useIn.thatProject') }) });
    } catch (e) {
      const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? '');
      setSaid({
        ok: false,
        text: /duplicate|unique/i.test(message)
          ? t('useIn.already')
          : /at most five/i.test(message)
          ? t('useIn.full')
          : message || t('useIn.failed'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="mb-2 text-label text-[var(--on-surface-variant)]">
        {t('useIn.prompt', { name: source.title || t('useIn.thisProject') })}
      </p>
      <ProjectPicker projects={projects.filter((p) => p.id !== source.id)} folders={folders} disabled={busy} onPick={(id) => void pick(id)} />
      {said && (
        <p role={said.ok ? 'status' : 'alert'} className={`mt-2 text-label ${said.ok ? 'text-[var(--on-surface)]' : 'text-[var(--pm-error)]'}`}>
          {said.text}
        </p>
      )}
    </>
  );
}
