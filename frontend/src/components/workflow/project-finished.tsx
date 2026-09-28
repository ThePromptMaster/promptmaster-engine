'use client';

import { useMemo, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { downloadBlob, downloadFile } from '@/lib/utils';
import { exportFilename, toManuscriptMarkdown, type ExportBundle } from '@/lib/export/project-export';
import { deliverableStage, type CompletionSummary } from '@/lib/workflow/engine';
import type { Evaluation } from '@/types/project';
import { EvaluationScores } from './evaluation-scores';

interface Props {
  bundle: ExportBundle;
  completion: CompletionSummary;
  /** The deliverable's latest objective check, when one was ever run. */
  evaluation?: Evaluation;
  onReopen: () => void;
}

/**
 * The finished project, with the work at the centre (C4, Sean 28 Sep item
 * 15: "I need to see my book and pull it out as a Word or PDF file"). Read
 * it, copy it, save it as Markdown, Word or PDF, or reopen the project to
 * keep improving it. The stage-by-stage record stays below, as it was.
 */
export function ProjectFinished({ bundle, completion, evaluation, onReopen }: Props) {
  const { project, template } = bundle;
  const stage = deliverableStage(template);
  const isBook = stage?.renderer === 'long_form';
  const noun = isBook ? 'book' : 'work';
  const markdown = useMemo(() => toManuscriptMarkdown(bundle), [bundle]);
  const body = markdown.replace(/^# .*\n+/, '');
  const chapters = isBook ? (body.match(/^## /gm) ?? []).length : 0;
  const words = body.split(/\s+/).filter(Boolean).length;
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stem = () => exportFilename(project, 'md').replace(/\.md$/, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
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
      downloadBlob(await manuscriptToDocx(markdown, project.title || 'Untitled project'), `${stem()}.docx`);
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
              isBook ? `${chapters} chapter${chapters === 1 ? '' : 's'}` : null,
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
        <button onClick={onReopen} className={secondary}>
          Continue improving
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">
          {note}
        </p>
      )}
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        Export PDF opens a print view — choose “Save as PDF” in the print dialog. Word keeps headings, paragraphs and
        bullets; tables and code arrive as plain text.
      </p>

      {reading && markdown && (
        <div className="mt-6 rounded-xl bg-[var(--surface-container-lowest)] px-6 py-5">
          <MarkdownOutput content={markdown} />
        </div>
      )}
    </section>
  );
}
