'use client';

import { useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n/i18n-provider';
import type { ContactRow } from '@/lib/outreach/contacts';
import { canUse, groupDecisions, type DecisionGroup } from '@/lib/outreach/decisions';
import { researchLeft, runResearch } from '@/lib/outreach/research-run';
import { signedFileUrls } from '@/lib/supabase/project-files';
import { assessKey, claimAssess, releaseAssess, reportAssess, useAssessRun } from '@/lib/workflow/assess-lock';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import { keepFound } from '@/lib/workflow/web-found';
import type { OutreachContext } from '@/components/workflow/renderers/types';
import type { ProjectFile } from '@/types/project';

const quiet = 'rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label font-medium text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50';
const BRIEF_MAX = 20_000;

/**
 * "Fill in the blanks" (Sean, 26 Nov): the rows missing a person, an address or a detail are
 * searched on the web, five a call, each value saved with its page. Go runs the same search; one
 * lock per Contacts stage keeps the two apart, and the page shows Go's progress while it runs.
 */
export function ResearchBar({ context, stageId, content, readOnly }: { context: OutreachContext; stageId: string; content: string | null | undefined; readOnly: boolean }) {
  const t = useT();
  const key = assessKey(context.project.id, stageId);
  const run = useAssessRun(key);
  const left = researchLeft(content);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const webOn = context.project.web_access === 'on';

  if (!left && !run && !said && !error) return null;

  const start = async () => {
    const controller = new AbortController();
    if (!claimAssess(key, 'page', controller)) return;
    stop.current = controller;
    setError(null);
    setSaid(null);
    setProgress({ done: 0, total: left });
    try {
      const res = await runResearch({
        content,
        call: (rows) => api.researchContacts({ inputs: inputsFrom(context.project), brief: context.briefText.slice(0, BRIEF_MAX), rows, web_access: 'on' }, controller.signal),
        keep: (r) => keepFound(context.project, r, { stageId }),
        save: (next, summary) => context.save(stageId, next, 'outreach_research', summary),
        signal: controller.signal,
        onProgress: (done, total) => {
          setProgress({ done, total });
          reportAssess(key, 'page', done, total - done);
        },
      });
      if (res.error) setError(res.error);
      else setSaid(res.stopped ? t('outreach.researchStopped', { left: res.left }) : t('outreach.researchDone', { researched: res.researched, filled: res.filled }));
    } finally {
      releaseAssess(key, 'page');
      stop.current = null;
      setProgress(null);
    }
  };

  const goRunning = run?.by === 'go';
  return (
    <div data-research className="space-y-2 rounded-xl bg-[var(--surface-container-low)] p-3">
      {goRunning ? (
        <p role="status" className="text-label text-[var(--on-surface)]" data-research-go>
          {t('outreach.researchingGo', { done: run.judged, total: run.judged + (run.left ?? 0) })}
        </p>
      ) : progress ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-label text-[var(--on-surface)]" data-research-progress>{t('outreach.researching', progress)}</p>
          <button type="button" className={quiet} onClick={() => stop.current?.abort()} data-research-stop>{t('outreach.stop')}</button>
        </div>
      ) : left > 0 && !readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-label text-[var(--on-surface)]">{webOn ? t('outreach.researchLead', { count: left }) : t('outreach.researchWebOff')}</p>
          <button type="button" className={primary} disabled={!webOn || Boolean(run)} onClick={() => void start()} data-research-start>{t('outreach.research')}</button>
        </div>
      ) : null}
      {said && <p role="status" className="text-label text-[var(--on-surface-variant)]" data-research-said>{said}</p>}
      {error && <p role="alert" className="text-label text-[var(--pm-error)]">{error}</p>}
    </div>
  );
}

/** The rows waiting on the user, grouped: one press answers a group (`lib/outreach/decisions.ts`). */
export function DecisionGroups({ rows, busy, readOnly, onDecide }: { rows: readonly ContactRow[]; busy: string | null; readOnly: boolean; onDecide: (group: DecisionGroup, answer: 'use' | 'skip') => void }) {
  const t = useT();
  const groups = groupDecisions(rows);
  if (!groups.length) return null;
  return (
    <div data-decision-groups className="space-y-2 rounded-xl bg-[color-mix(in_srgb,var(--pm-tertiary)_10%,transparent)] p-3">
      <p className="text-label font-semibold text-[var(--on-surface)]">{t('outreach.needsYou')}</p>
      <ul className="space-y-1.5">
        {groups.map((g) => {
          const names = rows.filter((r) => g.rowIds.includes(r.id)).map((r) => r.name || r.company || r.email).filter(Boolean);
          return (
            <li key={g.key} data-decision-group={g.kind} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-label text-[var(--on-surface)]">
                {t(`outreach.group.${g.kind}`, { count: g.rowIds.length, domain: g.domain ?? '' })}{' '}
                <span className="text-[var(--on-surface-variant)]">{names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}</span>
              </span>
              {!readOnly && (
                <span className="flex gap-2">
                  {canUse(g.kind) && (
                    <button type="button" className={quiet} disabled={busy !== null} onClick={() => onDecide(g, 'use')} data-decide-use>{t(`outreach.use.${g.kind as 'guess' | 'general' | 'no_name' | 'contacted' | 'import_change'}`)}</button>
                  )}
                  <button type="button" className={quiet} disabled={busy !== null} onClick={() => onDecide(g, 'skip')} data-decide-skip>{g.kind === 'import_change' ? t('outreach.keepMine') : t('outreach.skipThem')}</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A table attached when the project was started, offered as the list (27 Nov). */
export function StartFiles({ files, onUse, busy }: { files: readonly ProjectFile[]; onUse: (raw: string, name: string) => void; busy: boolean }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const tables = files.filter((f) => f.preview?.kind === 'table');
  if (!tables.length) return null;
  const use = async (f: ProjectFile) => {
    setError(null);
    try {
      const urls = await signedFileUrls([f], 120);
      const url = urls[f.id];
      if (!url) throw new Error(f.name);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      onUse(await res.text(), f.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-start-files>
      {tables.map((f) => (
        <button key={f.id} type="button" className={quiet} disabled={busy} onClick={() => void use(f)} data-start-file>
          {t('outreach.useStartFile', { name: f.name })}
        </button>
      ))}
      {error && <span role="alert" className="text-label text-[var(--pm-error)]">{error}</span>}
    </div>
  );
}
