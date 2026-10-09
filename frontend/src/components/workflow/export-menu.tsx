'use client';

/**
 * FR-20's export, where a user looks for it: at the top of the project.
 *
 * Two entries rather than one, because they are two different requests. Most
 * of the time the answer to "I want this out" is the document — Markdown, the
 * artifact, ready to paste. The full record is the other request, made less
 * often and by someone with a reason: an auditor, a migration, or a user who
 * wants to satisfy themselves that the version history and the evaluations are
 * really stored rather than rendered.
 *
 * `downloadFile` has existed in lib/utils.ts since the legacy flow and has had
 * no callers since /session was retired. This is what it was for.
 */

import { deliverableNouns } from '@/lib/workflow/labels';
import { useEffect, useRef, useState } from 'react';

import { downloadBlob, downloadFile } from '@/lib/utils';
import {
  exportFilename,
  toJson,
  toManuscriptMarkdown,
  toMarkdown,
  type ExportBundle,
} from '@/lib/export/project-export';

export function ExportMenu({ bundle }: { bundle: ExportBundle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function exportMarkdown() {
    const { markdownWithImageLinks } = await import('@/lib/export/images-export');
    downloadFile(
      await markdownWithImageLinks(toMarkdown(bundle), bundle.project.data_files),
      exportFilename(bundle.project, 'md'),
      'text/markdown;charset=utf-8'
    );
    setOpen(false);
  }

  const manuscript = toManuscriptMarkdown(bundle);
  const { deliverable: noun, unit } = deliverableNouns(bundle.template);
  async function exportWord() {
    const { manuscriptToDocx } = await import('@/lib/export/docx-export');
    const { imagesForDocx } = await import('@/lib/export/images-export');
    const blob = await manuscriptToDocx(manuscript, bundle.project.title || 'Untitled project', await imagesForDocx(manuscript, bundle.project.data_files));
    downloadBlob(blob, exportFilename(bundle.project, 'md').replace(/\.md$/, '.docx'));
    setOpen(false);
  }

  // M2 (8 Oct): the work as LaTeX, its mathematics as written and its code verbatim.
  async function exportLatex() {
    const { markdownToLatex } = await import('@/lib/export/latex-export');
    const title = bundle.project.title || 'Untitled project';
    downloadFile(markdownToLatex(manuscript || toMarkdown(bundle), title), exportFilename(bundle.project, 'md').replace(/\.md$/, '.tex'), 'application/x-tex;charset=utf-8');
    setOpen(false);
  }

  function exportJson() {
    downloadFile(
      toJson(bundle),
      exportFilename(bundle.project, 'json'),
      'application/json;charset=utf-8'
    );
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          download
        </span>
        Export
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-[300px] overflow-hidden rounded-xl bg-[var(--surface-container-lowest)] py-1 shadow-[0_2px_4px_rgba(25,28,30,0.06),0_12px_28px_-12px_rgba(25,28,30,0.28)]"
        >
          <button
            role="menuitem"
            onClick={() => void exportMarkdown()}
            className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
          >
            <span className="block text-body text-[var(--on-surface)]">Markdown document</span>
            <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
              Every stage you reached, in order, ready to paste.
            </span>
          </button>
          <button
            role="menuitem"
            onClick={() => void exportLatex()}
            className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
          >
            <span className="block text-body text-[var(--on-surface)]">LaTeX (.tex)</span>
            <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
              {manuscript ? `The ${noun}` : 'Every stage you reached'}, equations as written and code verbatim.
            </span>
          </button>
          {manuscript && (
            <>
              <button
                role="menuitem"
                onClick={() => void exportWord()}
                className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
              >
                <span className="block text-body text-[var(--on-surface)]">Word document (.docx)</span>
                <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                  The {noun} alone — title and {unit}s.
                </span>
              </button>
              <a
                role="menuitem"
                href={`/projects/${bundle.project.id}/print`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
              >
                <span className="block text-body text-[var(--on-surface)]">PDF (print view)</span>
                <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
                  Opens the {noun} to print; choose “Save as PDF”.
                </span>
              </a>
            </>
          )}
          <button
            role="menuitem"
            onClick={exportJson}
            className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
          >
            <span className="block text-body text-[var(--on-surface)]">Full record (JSON)</span>
            <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
              Project, stage history, every version and every evaluation.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
