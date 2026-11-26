'use client';

import { useEffect, useMemo, useState } from 'react';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { changedSince, projectFactsChangedSince, type InputsUsed } from '@/lib/folders/inputs-used';
import { resolveInherited } from '@/lib/folders/inheritance';
import { linkQuotes, quotesIn, sourceDocs, type QuoteLink } from '@/lib/evidence/quote-links';
import { getInputsUsed } from '@/lib/supabase/versions';
import { useProjectStore } from '@/stores/project-store';
import type { ArtifactVersion } from '@/types/project';
import { useLevelName } from '@/components/folders/level-name';
import { SourceViewer } from './source-viewer';

/**
 * What a version was made with, and the passages its quotes come from (Sean,
 * 23 Nov: "see the prompt version, source transcript, and requirements applied,
 * and jump to the transcript passage behind a finding"; L-281). Read from the
 * version's own record, so an older version shows what it used, not what the
 * project holds now; what has changed since is said beside it.
 */
export function VersionInputs({ version }: { version: ArtifactVersion }) {
  const t = useT();
  const locale = useLocale();
  const levelName = useLevelName();
  const project = useProjectStore((s) => s.project);
  const facts = useProjectStore((s) => s.facts);
  const source = useProjectStore((s) => s.inheritedSource);
  // Not loaded with the version list: read when the panel opens (it is keyed by version).
  const [fetched, setFetched] = useState<InputsUsed | null | undefined>(undefined);
  const used = version.inputs_used !== undefined ? version.inputs_used : fetched;
  const [open, setOpen] = useState<QuoteLink | null>(null);

  useEffect(() => {
    if (version.inputs_used !== undefined) return;
    let live = true;
    getInputsUsed(version.id).then((u) => live && setFetched(u), () => live && setFetched(null));
    return () => {
      live = false;
    };
  }, [version.id, version.inputs_used]);

  const inherited = useMemo(
    () => (source && project ? resolveInherited({ ...source, folderId: project.folder_id, projectFacts: facts, projectId: project.id }) : undefined),
    [source, project, facts]
  );
  const links = useMemo(
    () => linkQuotes(quotesIn(version.content ?? ''), sourceDocs(project?.context, inherited?.documents ?? [])),
    [version.content, project?.context, inherited]
  );
  const folderSince = changedSince(used, inherited);
  // The project's own facts too (26 Nov, L-290): a delivery date replaced since this version was made.
  const ownSince = projectFactsChangedSince(used, facts);
  const since = folderSince || ownSince
    ? { added: [...(folderSince?.added ?? []), ...(ownSince?.added ?? [])], removed: [...(folderSince?.removed ?? []), ...(ownSince?.removed ?? [])] }
    : null;
  const when = new Date(version.created_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const head = 'text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]';
  const chip = 'me-1 rounded bg-[var(--surface-container-highest)] px-1.5 py-0.5 text-label text-[var(--on-surface-variant)]';

  return (
    <section aria-label={t('evid.title')} className="mb-4 space-y-4 rounded-xl bg-[var(--surface-container-low)] px-5 py-4 text-body text-[var(--on-surface)]">
      {used === undefined && <p className="text-label text-[var(--on-surface-variant)]">{t('frules.loading')}</p>}
      {used === null && <p className="text-label text-[var(--on-surface-variant)]">{t('evid.notRecorded')}</p>}
      {used && (
        <>
          <div>
            <h3 className={head}>{t('evid.made')}</h3>
            <p className="mt-1">
              {used.template ? t('evid.workflow', { name: used.template.name, version: used.template.version }) : ''}
              {` · ${used.stage.label}`}
              {used.model ? ` · ${used.model}` : ''}
              {` · ${when}`}
            </p>
            {used.stage.instruction && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.instruction', { text: used.stage.instruction })}</p>}
          </div>

          <div>
            <h3 className={head}>{t('evid.requirements')}</h3>
            {used.requirements.inherited === null && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.foldersUnread')}</p>}
            <ul className="mt-1 space-y-1">
              {used.requirements.exceptions.map((e) => (
                <li key={e.id}>
                  <span className={chip}>{t('frules.exception')}</span>
                  {e.statement}
                  <span className="block text-label text-[var(--on-surface-variant)]">
                    {t('evid.exceptionFor', { rule: e.rule, who: e.authorised_by, where: e.level ? levelName(e.level) : t('frules.thisProjectCap') })}
                  </span>
                </li>
              ))}
              {(used.requirements.inherited ?? []).map((r) => (
                <li key={r.id}>
                  {r.required && <span className={chip}>{t('frules.required')}</span>}
                  {r.statement}
                  <span className="ms-2 text-label text-[var(--on-surface-variant)]">{t('frules.fromLevel', { level: levelName(r.level) })}</span>
                </li>
              ))}
              {used.requirements.project.map((f) => (
                <li key={f.id}>
                  {f.statement}
                  <span className="ms-2 text-label text-[var(--on-surface-variant)]">{t('evid.thisProject')}</span>
                </li>
              ))}
            </ul>
            {!used.requirements.exceptions.length && !(used.requirements.inherited ?? []).length && !used.requirements.project.length && (
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.noRequirements')}</p>
            )}
            {used.requirements.unresolved > 0 && (
              <p className="mt-1 text-label text-[var(--pm-error)]">{t('evid.unresolved', { count: used.requirements.unresolved })}</p>
            )}
            {since && (since.added.length > 0 || since.removed.length > 0) && (
              <div className="mt-2 rounded-lg bg-[var(--surface-container)] px-3 py-2 text-label">
                <p className="font-semibold text-[var(--on-surface)]">{t('evid.changedSince')}</p>
                {since.added.map((s) => <p key={`a${s}`}>{t('evid.added', { text: s })}</p>)}
                {since.removed.map((s) => <p key={`r${s}`}>{t('evid.removed', { text: s })}</p>)}
              </div>
            )}
          </div>

          <div>
            <h3 className={head}>{t('evid.documents')}</h3>
            {used.documents.length === 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.noDocuments')}</p>}
            <ul className="mt-1 space-y-0.5">
              {used.documents.map((d, i) => (
                <li key={`${d.name}${i}`} className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">description</span>
                  {d.name || t('evid.projectMaterial')}
                  <span className="text-label text-[var(--on-surface-variant)]">{d.level ? t('frules.fromLevel', { level: levelName(d.level) }) : t('evid.inProject')}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div>
        <h3 className={head}>{t('evid.quotes')}</h3>
        {links.length === 0 && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('evid.noQuotes')}</p>}
        <ul className="mt-1 space-y-1.5">
          {links.map((l) => (
            <li key={l.quote} className="flex flex-wrap items-start gap-2">
              <span className="min-w-0 flex-1">“{l.quote}”</span>
              <button type="button" onClick={() => setOpen(l)} className="shrink-0 rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]">
                {t('evid.show', { name: l.doc.name || t('evid.projectMaterial') })}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {open && <SourceViewer link={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
