'use client';

import { useEffect, useMemo, useState } from 'react';

import { versionColour } from '@/lib/appearance/colours';
import { projectTimeline, type TimelineEntry } from '@/lib/workflow/timeline';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { ArtifactVersion } from '@/types/project';

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * The project's history, to look back at and reopen (14 Oct call: "can you
 * look up what you've done in the past?"). Every version of every stage, in
 * its version colour, and the decisions between them. Opening a version shows
 * it on its stage, where Restore already lives — nothing is changed from here.
 */
export function ProjectTimeline({
  template,
  events,
  stages,
  onOpen,
}: {
  template: Pick<WorkflowTemplate, 'stages'>;
  events: readonly WorkflowEvent[];
  stages: Record<string, { versions: ArtifactVersion[] } | undefined>;
  onOpen: (stageId: string, versionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => projectTimeline(template, events, stages), [template, events, stages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!entries.length) return null;
  const days = groupByDay(entries);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">history</span>
        Timeline
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Project timeline"
          className="fixed inset-0 z-40 flex justify-end bg-[rgba(25,28,30,0.35)]"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="h-full w-full max-w-[460px] overflow-y-auto bg-[var(--surface-container-lowest)] px-6 py-5 shadow-[0_0_40px_rgba(25,28,30,0.12)]">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="mr-auto text-title text-[var(--on-surface)]">Timeline</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
              >
                Close
              </button>
            </div>
            <p className="mb-4 text-label text-[var(--on-surface-variant)]">
              Every version and decision, newest first. Open a version to read it on its stage; Restore is there. Nothing here changes the work.
            </p>
            {days.map(([day, items]) => (
              <section key={day} aria-label={day} className="mb-5">
                <p className="mb-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{day}</p>
                <ol className="space-y-1.5">
                  {items.map((e) => (
                    <li key={e.key} className="flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-container-low)]">
                      {e.kind === 'version' ? (
                        <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: versionColour(e.versionNumber ?? 1) }} />
                      ) : (
                        <span aria-hidden className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[var(--on-surface-variant)]">flag</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-label text-[var(--on-surface)]">
                          {e.stageLabel && <span className="font-semibold">{e.stageLabel} · </span>}
                          {e.title}
                          {e.current && <span className="ml-1 text-[var(--on-surface-variant)]">(current)</span>}
                        </p>
                        {e.detail && <p className="mt-0.5 line-clamp-2 text-label text-[var(--on-surface-variant)]">{e.detail}</p>}
                      </div>
                      <span className="shrink-0 text-label text-[var(--outline)]">{TIME.format(new Date(e.at))}</span>
                      {e.versionId && (
                        <button
                          onClick={() => {
                            onOpen(e.stageId, e.versionId!);
                            setOpen(false);
                          }}
                          aria-label={`Open ${e.stageLabel} v${e.versionNumber}`}
                          className="shrink-0 rounded-md bg-[var(--surface-container-high)] px-2 py-0.5 text-label text-[var(--on-surface)]"
                        >
                          Open
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function groupByDay(entries: TimelineEntry[]): [string, TimelineEntry[]][] {
  const out: [string, TimelineEntry[]][] = [];
  for (const e of entries) {
    const day = DAY.format(new Date(e.at));
    const last = out.at(-1);
    if (last && last[0] === day) last[1].push(e);
    else out.push([day, [e]]);
  }
  return out;
}
