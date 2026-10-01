'use client';

import { useEffect, useMemo, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { toManuscriptMarkdown, type ExportBundle } from '@/lib/export/project-export';
import { deliverableNouns } from '@/lib/workflow/labels';

/**
 * The whole thing being made, readable at any point — not only after Finish.
 *
 * The finished screen was the first place the full text could be read in one
 * piece, so a book three chapters in could only be seen a section at a time,
 * and the question "does the final artifact have a cleaner document view that
 * I am just not finding?" was a fair one (1 Oct, item 26 and question 12).
 * This shows what is written so far, as one document, and changes nothing.
 */
export function FullDocumentReader({ bundle }: { bundle: ExportBundle }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(() => toManuscriptMarkdown(bundle), [bundle]);
  const { deliverable: noun } = deliverableNouns(bundle.template);
  const words = useMemo(() => markdown.replace(/^# .*\n+/, '').split(/\s+/).filter(Boolean).length, [markdown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!markdown) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">menu_book</span>
        Read the full {noun}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`The full ${noun}`}
          className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-[rgba(25,28,30,0.45)] px-4 py-8"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="h-fit w-full max-w-[780px] rounded-2xl bg-[var(--surface-container-lowest)] px-8 py-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <p className="mr-auto text-label text-[var(--on-surface-variant)]">
                The {noun} as it stands · {words.toLocaleString()} words · reading only, nothing here changes it
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(markdown).then(() => setCopied(true), () => setCopied(false));
                }}
                className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)]"
              >
                Close
              </button>
            </div>
            <MarkdownOutput content={markdown} />
          </div>
        </div>
      )}
    </>
  );
}
