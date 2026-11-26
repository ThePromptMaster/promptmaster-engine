'use client';

import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import type { RenderedEmail } from '@/lib/outreach/render';

export interface PreviewHeaders {
  from: string;
  replyTo?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  attachments?: string[];
  signature?: string | null;
}

interface Props {
  /** The email as it goes out, with images shown or as a mail program shows them when off. */
  render: (imagesOff: boolean) => RenderedEmail;
  headers: PreviewHeaders;
}

const WIDTH = { desktop: 600, mobile: 375 } as const;

/**
 * The email exactly as it goes out (Sean, 26 Nov: "Show the actual From, Reply-To, To, CC/BCC,
 * subject, body, links, attachments, and signature before sending … preview it on desktop and
 * mobile"). The body is shown in a sandboxed frame, so nothing in it can run.
 */
export function EmailPreview({ render, headers }: Props) {
  const t = useT();
  const [size, setSize] = useState<keyof typeof WIDTH>('desktop');
  const [imagesOff, setImagesOff] = useState(false);
  const email = useMemo(() => render(imagesOff), [render, imagesOff]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#ffffff}</style></head><body>${email.html}</body></html>`;
  const none = t('outreach.none');
  const list = (xs: readonly string[] | undefined) => (xs && xs.length ? xs.join(', ') : none);
  const rows: [string, string][] = [
    [t('outreach.hFrom'), headers.from],
    ...(headers.replyTo ? ([[t('outreach.hReplyTo'), headers.replyTo]] as [string, string][]) : []),
    [t('outreach.hTo'), list(headers.to)],
    [t('outreach.hCc'), list(headers.cc)],
    [t('outreach.hBcc'), list(headers.bcc)],
    [t('outreach.hSubject'), email.subject || none],
    [t('outreach.hLinks'), list(email.links)],
    [t('outreach.hAttachments'), list(headers.attachments)],
    [t('outreach.hSignature'), headers.signature || none],
  ];
  return (
    <div data-email-preview className="rounded-xl bg-[var(--surface-container-low)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-label font-semibold uppercase tracking-wider text-[var(--on-surface-variant)]">{t('outreach.preview')}</span>
        <div role="group" className="ms-auto flex rounded-lg bg-[var(--surface-container-high)] p-0.5">
          {(['desktop', 'mobile'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={size === s}
              data-preview-size={s}
              onClick={() => setSize(s)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-label ${size === s ? 'bg-[var(--surface-container-lowest)] font-semibold text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)]'}`}
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">{s === 'desktop' ? 'computer' : 'smartphone'}</span>
              {t(s === 'desktop' ? 'outreach.previewDesktop' : 'outreach.previewMobile')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-label text-[var(--on-surface-variant)]">
          <input type="checkbox" data-images-off checked={imagesOff} onChange={(e) => setImagesOff(e.target.checked)} />
          {t('outreach.previewImagesOff')}
        </label>
      </div>
      <dl data-email-headers className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-label">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--on-surface-variant)]">{k}</dt>
            <dd className="min-w-0 break-words text-[var(--on-surface)]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto">
        <iframe
          title={t('outreach.preview')}
          sandbox=""
          srcDoc={doc}
          data-preview-frame
          className="mx-auto block h-[380px] rounded-lg bg-white"
          style={{ width: `${WIDTH[size]}px`, maxWidth: '100%' }}
        />
      </div>
    </div>
  );
}
