'use client';

import { useEffect, useRef, useState } from 'react';

import { ProjectPicker } from '@/components/workflow/project-references';
import { addReference } from '@/lib/supabase/references';
import type { ProjectFolder, ProjectSummary } from '@/types/project';

/**
 * "Use in a project…" from a project's card (client, 21 Oct, email 5): the
 * chosen project draws on this one from then on, as it would after "Use
 * another project" inside it.
 */
export function UseInProjectMenu({
  source,
  userId,
  projects,
  folders,
}: {
  source: ProjectSummary;
  userId: string;
  projects: readonly ProjectSummary[];
  folders: readonly ProjectFolder[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const pick = async (targetId: string) => {
    setBusy(true);
    setSaid(null);
    const target = projects.find((p) => p.id === targetId);
    try {
      await addReference(userId, targetId, source.id);
      setSaid({ ok: true, text: `“${target?.title || 'That project'}” now draws on this one.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? '');
      setSaid({
        ok: false,
        text: /duplicate|unique/i.test(message)
          ? 'That project already uses this one.'
          : /at most five/i.test(message)
          ? 'That project already uses five others, the most it can.'
          : message || 'It could not be added.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setSaid(null);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Use ${source.title || 'this project'} in another project`}
        title="Use in another project"
        className="rounded-lg p-2 text-[var(--on-surface-variant)] opacity-0 transition-opacity hover:bg-[var(--surface-container-high)] focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <span className="material-symbols-outlined text-[20px]">link</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Use in a project" className="absolute right-0 top-full z-20 mt-1 w-[300px] rounded-xl bg-[var(--surface-container-lowest)] p-3 shadow-[0_1px_2px_rgba(25,28,30,0.06),0_12px_28px_-12px_rgba(25,28,30,0.3)]">
          <p className="mb-2 text-label text-[var(--on-surface-variant)]">
            Which project should draw on “{source.title || 'this project'}”? Its finished work and facts go with that project&apos;s prompts.
          </p>
          <ProjectPicker projects={projects.filter((p) => p.id !== source.id)} folders={folders} disabled={busy} onPick={(id) => void pick(id)} />
          {said && (
            <p role={said.ok ? 'status' : 'alert'} className={`mt-2 text-label ${said.ok ? 'text-[var(--on-surface)]' : 'text-[var(--pm-error)]'}`}>
              {said.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
