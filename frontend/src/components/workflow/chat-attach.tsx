'use client';

import { useRef, useState } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { documentsOf, prepareFiles, type MessageAttachment } from '@/lib/data/attachments';
import { imageForMessage, normalizeImage } from '@/lib/data/normalize-image';
import { PICKABLE_EXTENSIONS, imagePreview, isImage, rejectReason } from '@/lib/data/preview';
import { attachProjectFile } from '@/lib/supabase/project-files';
import type { Project } from '@/types/project';

/**
 * Attaching a file from the side chat (6 Oct, email 9: "Attachments aren't
 * working"). The chat is where people reach for a paperclip, and it had none.
 *
 * It stores the file exactly as the project's data panel does — same checks,
 * same `project_files` row — and then asks before a document's words go into
 * the project context.
 *
 * What was attached also goes with the next message (5 Nov: eleven screenshots
 * uploaded, and the chat answered "No, no photos came through"). The chat request
 * carried no files at all; only text added to the project context ever reached it.
 */
export function ChatAttach({
  project,
  existingNames,
  onChanged,
  onAddToContext,
  onForNextMessage,
  disabled = false,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  existingNames: readonly string[];
  onChanged: () => void | Promise<void>;
  /** Adds the documents' words to the project context. Returns the ones cut for length. */
  onAddToContext?: (documents: { name: string; text: string }[]) => string[];
  /** What was attached, to go with the next message. */
  onForNextMessage?: (items: MessageAttachment[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readable, setReadable] = useState<{ name: string; text: string }[]>([]);

  const attach = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setMessage(null);
    setReadable([]);
    try {
      const files = Array.from(picked);
      const images = files.filter((f) => isImage(f.name));
      const prepared = await prepareFiles(files.filter((f) => !isImage(f.name)), existingNames);
      const stored: string[] = [];
      const failed: string[] = [...prepared.errors];
      for (const p of prepared.ready) {
        try {
          await attachProjectFile(project, p.file, p.preview);
          stored.push(p.file.name);
        } catch (e) {
          failed.push(t('pnl.couldNotStore', { name: p.file.name, why: e instanceof Error && e.message ? ` (${e.message})` : '' }));
        }
      }
      // Photos from the chat are stored too (U1, 8 Oct: Sean attached from his
      // iPhone and could not tell whether it had worked). Each gets the caption
      // its name suggests, which can be changed under the project's images.
      const added: string[] = [];
      const forNext: MessageAttachment[] = [];
      for (const picked of images) {
        const normal = await normalizeImage(picked);
        if ('error' in normal) {
          failed.push(normal.error);
          continue;
        }
        const reason = rejectReason(normal.file.name, normal.file.size, [...existingNames, ...stored, ...added]);
        if (reason) {
          failed.push(reason);
          continue;
        }
        try {
          const bitmap = await createImageBitmap(normal.file).catch(() => null);
          await attachProjectFile(project, normal.file, imagePreview(normal.file.name, '', bitmap?.width ?? 0, bitmap?.height ?? 0));
          bitmap?.close();
          added.push(normal.file.name);
          const image = await imageForMessage(normal.file);
          forNext.push(image ? { name: normal.file.name, image } : { name: normal.file.name, not_read: true });
          if (normal.note) prepared.notes.push(normal.note);
        } catch (e) {
          failed.push(t('pnl.couldNotStore', { name: normal.file.name, why: e instanceof Error && e.message ? ` (${e.message})` : '' }));
        }
      }
      if (added.length) {
        prepared.notes.push(t('pnl.addedImages', { count: added.length, names: added.join(', ') }));
      }
      const docs = documentsOf(prepared.ready.filter((p) => stored.includes(p.file.name)));
      setReadable(docs);
      const dataFiles = stored.filter((name) => !docs.some((d) => d.name === name));
      const withNext: MessageAttachment[] = [...docs.map((d) => ({ name: d.name, text: d.text })), ...dataFiles.map((name) => ({ name })), ...forNext];
      if (withNext.length) onForNextMessage?.(withNext);
      setMessage(
        [
          stored.length ? t('pnl.attachedTo', { names: stored.join(', ') }) : '',
          ...prepared.notes,
          ...failed,
          withNext.length && onForNextMessage ? t('pnl.goesWithNext') : '',
        ]
          .filter(Boolean)
          .join(' ')
      );
      if (stored.length || added.length) await onChanged();
    } catch {
      // It said nothing at all when a file could not be read (5 Nov).
      setMessage(t('pnl.attachFailed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    // `min-w-0 flex-1`, not `shrink-0`: the status line below the button can
    // be a long sentence, and a column that refused to shrink grew to its full
    // width and pushed Send over the composer (14 Oct call, "attachment
    // buttons overlapping"). Now the sentence wraps beside Send instead.
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        multiple
        accept={PICKABLE_EXTENSIONS.join(',')}
        className="hidden"
        aria-label={t('pnl.attachFile')}
        onChange={(e) => void attach(e.target.files)}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || busy}
        title={t('pnl.attachFile')}
        className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-1 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[18px]">attach_file</span>
        {busy ? t('pnl.attaching') : t('pnl.attach')}
      </button>
      {message && (
        <p role="status" className="break-words text-label text-[var(--on-surface-variant)]">
          {message}
        </p>
      )}
      {readable.length > 0 && onAddToContext && (
        <button
          type="button"
          onClick={() => {
            const cut = onAddToContext(readable);
            setReadable([]);
            setMessage(cut.length ? t('pnl.addedPart', { names: cut.join(', ') }) : t('pnl.addedToContext'));
          }}
          className="self-start rounded-lg bg-[var(--surface-container-high)] px-3 py-1 text-label text-[var(--on-surface)]"
        >
          {t('pnl.addText')}
        </button>
      )}
    </div>
  );
}
