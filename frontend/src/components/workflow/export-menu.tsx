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

import { useEffect, useRef, useState } from 'react';

import { downloadFile } from '@/lib/utils';
import {
  exportFilename,
  toJson,
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

  function exportMarkdown() {
    downloadFile(
      toMarkdown(bundle),
      exportFilename(bundle.project, 'md'),
      'text/markdown;charset=utf-8'
    );
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
            onClick={exportMarkdown}
            className="block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-container-low)]"
          >
            <span className="block text-body text-[var(--on-surface)]">Markdown document</span>
            <span className="mt-0.5 block text-label text-[var(--on-surface-variant)]">
              Every stage you reached, in order, ready to paste.
            </span>
          </button>
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
