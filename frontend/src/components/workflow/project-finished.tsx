'use client';

import { useMemo, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { downloadBlob, downloadFile } from '@/lib/utils';
import { carriedForward, CARRIED_HEADING, exportFilename, toManuscriptMarkdown, type ExportBundle } from '@/lib/export/project-export';
import { deliverableStage, type CompletionSummary } from '@/lib/workflow/engine';
import { deliverableNouns } from '@/lib/workflow/labels';
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
  const { project, template } = bundle;
  const stage = deliverableStage(template);
  const inSections = stage?.renderer === 'long_form';
  const { deliverable: noun, unit } = deliverableNouns(template);
  const markdown = useMemo(() => toManuscriptMarkdown(bundle), [bundle]);
  const body = markdown.replace(/^# .*\n+/, '');
  const carried = useMemo(() => carriedForward(bundle), [bundle]);
  // The carried-forward list closes the document; it is not a chapter.
  const chapters = inSections ? (body.match(/^## /gm) ?? []).length - (carried.length ? 1 : 0) : 0;
  const words = body.split(/\s+/).filter(Boolean).length;
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stem = () => exportFilename(project, 'md').replace(/\.md$/, '');
  const copy = async () => {
    try {
      const { markdownWithImageLinks } = await import('@/lib/export/images-export');
      await navigator.clipboard.writeText(await markdownWithImageLinks(markdown, project.data_files));
      setNote('Copied.');
    } catch {
      setNote('Could not copy — select the text and copy it yourself.');
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
      setNote(e instanceof Error && e.message ? e.message : 'The Word file could not be built.');
    } finally {
      setBusy(false);
    }
  };

  const action = 'rounded-lg px-4 py-2 text-title transition-colors';
  const primary = `${action} bg-[var(--pm-primary)] text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50`;
  const secondary = `${action} bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50`;

  return (
    <section aria-label="Your finished work" className="mb-8 rounded-2xl bg-[var(--surface-container)] px-6 py-6">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">Finished</p>
      <h2 className="mt-1 text-[1.75rem] font-semibold leading-tight text-[var(--on-surface)]">
        {markdown ? `Your ${noun} is complete` : 'This project is finished'}
      </h2>
      <p className="mt-2 text-body text-[var(--on-surface-variant)]">
        {markdown
          ? [
              inSections ? `${chapters} ${unit}${chapters === 1 ? '' : 's'}` : null,
              `${words.toLocaleString()} words`,
              `${completion.completed} stage${completion.completed === 1 ? '' : 's'} done`,
              completion.skipped ? `${completion.skipped} skipped` : null,
              completion.leftOpen ? `${completion.leftOpen} left open` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : `Nothing was written on ${stage?.label ?? 'the deliverable stage'}, so there is no ${noun} to read or export yet.`}
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
              {reading ? `Hide the ${noun}` : `Read the full ${noun}`}
            </button>
            <button onClick={() => void copy()} className={secondary}>
              Copy
            </button>
            <button
              onClick={() => downloadFile(markdown, `${stem()}.md`, 'text/markdown;charset=utf-8')}
              className={secondary}
            >
              Export Markdown
            </button>
            <button onClick={() => void word()} disabled={busy} className={secondary}>
              {busy ? 'Building…' : 'Export Word'}
            </button>
            <a
              href={`/projects/${project.id}/print`}
              target="_blank"
              rel="noreferrer"
              className={secondary}
            >
              Export PDF
            </a>
          </>
        )}
        {markdown && onEdit && (
          <button onClick={onEdit} className={secondary}>
            Edit the {noun}
          </button>
        )}
        {markdown && onNewVersion && (
          <button
            onClick={() => {
              setBusy(true);
              setNote(null);
              onNewVersion()
                .catch((e: unknown) => setNote(e instanceof Error && e.message ? e.message : 'A new version could not be started.'))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className={secondary}
          >
            Start a new version
          </button>
        )}
        <button onClick={onReopen} className={secondary}>
          Continue improving
        </button>
      </div>
      {carried.length > 0 && (
        <div data-carried-forward className="mt-5 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
          <h3 className="text-title text-[var(--on-surface)]">{CARRIED_HEADING}</h3>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
            What you carried forward on the final review. It goes out with the {noun}, at the end of every export.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-[var(--on-surface)]">
            {carried.map((c, i) => (
              <li key={i}>
                {c.item}
                {c.reason && <span className="text-[var(--on-surface-variant)]"> — {c.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">
          {note}
        </p>
      )}
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        Export PDF opens a print view — choose “Save as PDF” in the print dialog. Word keeps headings, paragraphs and
        bullets; tables and code arrive as plain text.
        {markdown && onNewVersion ? ` Start a new version keeps this ${noun} in the version history as it is and reopens it for the next one.` : ''}
      </p>

      {reading && markdown && (
        <div className="mt-6 rounded-xl bg-[var(--surface-container-lowest)] px-6 py-5">
          <MarkdownOutput content={markdown} />
        </div>
      )}
    </section>
  );
}
