'use client';

import { useMemo, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { tr } from '@/lib/i18n/store';
import { nounText, stageText, unitsText } from '@/lib/i18n/templates';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { downloadBlob, downloadFile } from '@/lib/utils';
import { carriedForward, CARRIED_HEADING, exportFilename, toManuscriptMarkdown, type ExportBundle } from '@/lib/export/project-export';
import { deliverableStage, type CompletionSummary } from '@/lib/workflow/engine';
import { deliverableNouns } from '@/lib/workflow/labels';
import { asksForChangeLog, missingParts } from '@/lib/workflow/requested-parts';
import { internalMentions } from '@/lib/workflow/reader-text';
import type { Evaluation } from '@/types/project';
import { EvaluationScores } from './evaluation-scores';

interface Props {
  bundle: ExportBundle;
  completion: CompletionSummary;
  /** The deliverable's latest objective check, when one was ever run. */
  evaluation?: Evaluation;
  onReopen: () => void;
  /** Reopen the project and go to the stage that holds the work. */
  onEdit?: () => void;
  /** Keep this finished version in the history, then reopen to work on the next one. */
  onNewVersion?: () => Promise<void>;
}

/**
 * The finished project, with the work at the centre (C4, Sean 28 Sep item
 * 15: "I need to see my book and pull it out as a Word or PDF file"). Read
 * it, copy it, save it as Markdown, Word or PDF, or reopen the project to
 * keep improving it. The stage-by-stage record stays below, as it was.
 */
export function ProjectFinished({ bundle, completion, evaluation, onReopen, onEdit, onNewVersion }: Props) {
  const t = useT();
  const locale = useLocale();
  const { project, template } = bundle;
  const stage = deliverableStage(template);
  const inSections = stage?.renderer === 'long_form';
  const nouns = deliverableNouns(template, project);
  const noun = nounText(locale, nouns.deliverable);
  const unit = nouns.unit;
  const markdown = useMemo(() => toManuscriptMarkdown(bundle), [bundle]);
  const body = markdown.replace(/^# .*\n+/, '');
  const carried = useMemo(() => carriedForward(bundle), [bundle]);
  // A part the user asked for that the finished text lacks (28 Oct, HarborDesk:
  // a requested change log was missing). Said, never a reason it can't finish.
  const missing = useMemo(() => missingParts(project, body), [project, body]);
  // Process talk still in the text after the notes were taken out: named, for
  // the user to decide, never rewritten (28 Oct).
  const mentions = useMemo(() => internalMentions(body, asksForChangeLog(project)), [project, body]);
  // The carried-forward list closes the document; it is not a chapter.
  const chapters = inSections ? (body.match(/^## /gm) ?? []).length - (carried.length ? 1 : 0) : 0;
  const words = body.split(/\s+/).filter(Boolean).length;
  const [reading, setReading] = useState(false);
  // A note belongs to the text it was about: once a new version is shown,
  // "Copied." would describe a copy of a different version (Sean, 17 Oct).
  const [said, setSaid] = useState<{ text: string; about: string } | null>(null);
  const note = said && said.about === markdown ? said.text : null;
  const setNote = (text: string | null) => setSaid(text === null ? null : { text, about: markdown });
  const [busy, setBusy] = useState(false);
  const head = stage ? bundle.stages[stage.id]?.versions.at(-1) : undefined;

  const stem = () => exportFilename(project, 'md').replace(/\.md$/, '');
  const copy = async () => {
    try {
      const { markdownWithImageLinks } = await import('@/lib/export/images-export');
      await navigator.clipboard.writeText(await markdownWithImageLinks(markdown, project.data_files));
      setNote(copiedNote(head));
    } catch {
      setNote(t('pnl.couldNotCopy'));
    }
  };
  const word = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { manuscriptToDocx } = await import('@/lib/export/docx-export');
      const { imagesForDocx } = await import('@/lib/export/images-export');
      downloadBlob(await manuscriptToDocx(markdown, project.title || 'Untitled project', await imagesForDocx(markdown, project.data_files)), `${stem()}.docx`);
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : t('pnl.wordFailed'));
    } finally {
      setBusy(false);
    }
  };

  const action = 'rounded-lg px-4 py-2 text-title transition-colors';
  const primary = `${action} bg-[var(--pm-primary)] text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50`;
  const secondary = `${action} bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50`;

  return (
    <section aria-label={t('pnl.finishedLabel')} className="mb-8 rounded-2xl bg-[var(--surface-container)] px-6 py-6">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t('pnl.finishedEyebrow')}</p>
      <h2 className="mt-1 text-[1.75rem] font-semibold leading-tight text-[var(--on-surface)]">
        {markdown ? t('pnl.complete', { noun }) : t('pnl.finished')}
      </h2>
      <p className="mt-2 text-body text-[var(--on-surface-variant)]">
        {markdown
          ? [
              inSections ? (locale === 'en' ? `${chapters} ${unit}${chapters === 1 ? '' : 's'}` : t('pnl.units', { n: chapters, units: unitsText(locale, unit) })) : null,
              t('pnl.words', { n: words.toLocaleString(locale) }),
              t('pnl.stagesDone', { count: completion.completed }),
              completion.skipped ? t('pnl.skippedN', { n: completion.skipped }) : null,
              completion.leftOpen ? t('pnl.leftOpenN', { n: completion.leftOpen }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : t('pnl.nothingWritten', { stage: stage ? stageText(locale, template.key, stage, 'label') : t('pnl.theDeliverable'), noun })}
      </p>
      {evaluation && (
        <div className="mt-2">
          <EvaluationScores evaluation={evaluation} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {markdown && (
          <>
            <button onClick={() => setReading((v) => !v)} aria-expanded={reading} className={primary}>
              {reading ? t('pnl.hideNoun', { noun }) : t('pnl.readNoun', { noun })}
            </button>
            <button onClick={() => void copy()} className={secondary}>
              {t('pnl.copy')}
            </button>
            <button
              onClick={() => downloadFile(markdown, `${stem()}.md`, 'text/markdown;charset=utf-8')}
              className={secondary}
            >
              {t('pnl.exportMd')}
            </button>
            <button onClick={() => void word()} disabled={busy} className={secondary}>
              {busy ? t('pnl.building') : t('pnl.exportWord')}
            </button>
            <a
              href={`/projects/${project.id}/print`}
              target="_blank"
              rel="noreferrer"
              className={secondary}
            >
              {t('pnl.exportPdf')}
            </a>
          </>
        )}
        {markdown && onEdit && (
          <button onClick={onEdit} className={secondary}>
            {t('pnl.editNoun', { noun })}
          </button>
        )}
        {markdown && onNewVersion && (
          <button
            onClick={() => {
              setBusy(true);
              setNote(null);
              onNewVersion()
                .catch((e: unknown) => setNote(e instanceof Error && e.message ? e.message : t('pnl.newVersionFailed')))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className={secondary}
          >
            {t('pnl.startNewVersion')}
          </button>
        )}
        <button onClick={onReopen} className={secondary}>
          {t('pnl.continueImproving')}
        </button>
      </div>
      {carried.length > 0 && (
        <div data-carried-forward className="mt-5 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
          <h3 className="text-title text-[var(--on-surface)]">{CARRIED_HEADING}</h3>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
            {t('pnl.carriedNote', { noun })}
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-body text-[var(--on-surface)]">
            {carried.map((c, i) => (
              <li key={i}>
                {c.item}
                {c.reason && <span className="text-[var(--on-surface-variant)]"> — {c.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div data-missing-parts className="mt-5 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
          <p className="text-body text-[var(--on-surface)]">
            {t('pnl.missingParts', { parts: missing.join(', '), noun })}
          </p>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('pnl.missingPartsNote')}</p>
          {onEdit && (
            <button onClick={onEdit} className={`mt-3 ${secondary}`}>
              {t('pnl.editNoun', { noun })}
            </button>
          )}
        </div>
      )}
      {mentions.length > 0 && (
        <div data-internal-mentions className="mt-5 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
          <p className="text-body text-[var(--on-surface)]">
            {t('pnl.internalMentions', { terms: mentions.map((m) => `“${m}”`).join(', ') })}
          </p>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('pnl.internalMentionsNote')}</p>
          {onEdit && (
            <button onClick={onEdit} className={`mt-3 ${secondary}`}>
              {t('pnl.editNoun', { noun })}
            </button>
          )}
        </div>
      )}
      {note && (
        <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">
          {note}
        </p>
      )}
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        {t('pnl.exportNote')}
        {markdown && onNewVersion ? t('pnl.newVersionNote', { noun }) : ''}
      </p>

      {reading && markdown && (
        <div className="mt-6 rounded-xl bg-[var(--surface-container-lowest)] px-6 py-5">
          <MarkdownOutput content={markdown} />
        </div>
      )}
    </section>
  );
}

/**
 * What the clipboard now holds, by version (Sean, 17 Oct: after starting a
 * new version, a bare "Copied." read as if the new version were the copied one).
 */
export function copiedNote(head?: { version_number: number; created_at: string }): string {
  if (!head) return tr('pnl.copied');
  const when = new Date(head.created_at);
  const date = Number.isNaN(when.getTime())
    ? ''
    : ` (${when.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })})`;
  return tr('pnl.copiedVersion', { n: head.version_number, date });
}
