'use client';

import { useState, type ReactNode } from 'react';

import { codeFilename, codeLanguage, hastText, type HastNode } from '@/lib/markdown/hast';

/**
 * A fenced block of code: its language named, its indentation kept, and
 * Copy / Download putting out exactly what was written — never the
 * highlighted markup (M1; Sean, 7 Oct: "Copying or exporting should preserve
 * the exact code without introducing formatting characters").
 */
export function CodeBlock({ node, children }: { node?: HastNode; children: ReactNode }) {
  const code = node?.children?.find((c) => c.tagName === 'code');
  const language = codeLanguage(code);
  const text = hastText(code).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = codeFilename(language);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl bg-[var(--surface-container-low)]" data-code-block>
      <div className="flex items-center justify-between gap-2 bg-[var(--surface-container)] px-3 py-1.5">
        <span className="font-mono text-[0.75rem] text-[var(--on-surface-variant)]">{language || 'text'}</span>
        <span className="flex gap-1">
          <button type="button" onClick={() => void copy()} className="rounded px-2 py-0.5 text-[0.75rem] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={download} className="rounded px-2 py-0.5 text-[0.75rem] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
            Download
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--on-surface)]">{children}</pre>
    </div>
  );
}

/** A display equation, with its LaTeX one click away. */
export function MathDisplay({ tex, children }: { tex: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="group relative" data-math-display>
      {children}
      {tex && (
        <button
          type="button"
          onClick={() => void copy()}
          className="absolute right-0 top-0 rounded px-2 py-0.5 text-[0.75rem] text-[var(--on-surface-variant)] opacity-0 hover:bg-[var(--surface-container-high)] focus:opacity-100 group-hover:opacity-100 print:hidden"
        >
          {copied ? 'Copied' : 'Copy LaTeX'}
        </button>
      )}
    </div>
  );
}
