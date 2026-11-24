'use client';

import { useEffect, useRef } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import type { QuoteLink } from '@/lib/evidence/quote-links';
import { useLevelName } from '@/components/folders/level-name';

/**
 * A document, opened at the passage a quote came from and with it marked
 * (Sean, 23 Nov: "jump to the transcript passage behind a finding"). The text
 * is shown as it is kept, so the place found is the place shown.
 */
export function SourceViewer({ link, onClose }: { link: QuoteLink; onClose: () => void }) {
  const t = useT();
  const levelName = useLevelName();
  const mark = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'center' });
  }, [link]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const text = link.doc.text;
  const name = link.doc.name || t('evid.projectMaterial');
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={name}>
      <button type="button" aria-label={t('evid.close')} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative flex h-full w-full max-w-[720px] flex-col bg-[var(--surface-container-lowest)] shadow-xl">
        <div className="flex items-start gap-3 bg-[var(--surface-container-low)] px-5 py-4">
          <span aria-hidden className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--on-surface-variant)]">description</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-title text-[var(--on-surface)]">{name}</p>
            <p className="text-label text-[var(--on-surface-variant)]">
              {link.doc.level ? t('frules.fromLevel', { level: levelName(link.doc.level as { name: string; kind: null }) }) : t('evid.inProject')}
              {link.matches > 1 ? ` · ${t('evid.firstOf', { count: link.matches })}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('evid.close')} className="rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]">
            <span aria-hidden className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="whitespace-pre-wrap break-words font-[inherit] text-body leading-relaxed text-[var(--on-surface)]">
            {text.slice(0, link.start)}
            <mark ref={mark} data-source-passage className="rounded bg-[color-mix(in_srgb,var(--pm-primary)_28%,transparent)] px-0.5 text-[var(--on-surface)]">
              {text.slice(link.start, link.end)}
            </mark>
            {text.slice(link.end)}
          </p>
        </div>
      </div>
    </div>
  );
}
