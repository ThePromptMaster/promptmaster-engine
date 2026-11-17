'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useRef, useState, type RefObject } from 'react';
import { useFileDrop } from '@/hooks/use-file-drop';

import { IMAGE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES, PICKABLE_EXTENSIONS, describePreview, imagePreview, isImage, rejectReason } from '@/lib/data/preview';
import { prepareFiles, storesFile } from '@/lib/data/attachments';
import { normalizeImage } from '@/lib/data/normalize-image';
import { useProjectImageUrls } from '@/components/shared/project-images';
import { attachProjectFile, removeProjectFile } from '@/lib/supabase/project-files';
import { errorMessage } from '@/lib/data/clean-text';
import type { Project, ProjectFile } from '@/types/project';

/**
 * The project's data files (1 Oct, items 16 and 17).
 *
 * "Execute when capable. Explicitly say when it cannot." PromptMaster could
 * only ever say it could not: there was nowhere to put a dataset. A file
 * attached here is available to the code Go runs, at /data/<name>, and its
 * columns and first rows are shown to the model so it can write that code.
 * Nothing else reads it.
 */
export function ProjectData({
  project,
  files,
  onChanged,
  onAddToContext,
  onReplaceInContext,
  readOnly = false,
  zone,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  files: ProjectFile[];
  onChanged: () => void | Promise<void>;
  /** A document's words into the project context, when the user says so. */
  onAddToContext?: (documents: { name: string; text: string }[]) => void;
  /**
   * A new version of a document already attached (17 Nov): its words replace the old ones
   * where the context holds them. Returns false when the context held none.
   */
  onReplaceInContext?: (name: string, text: string) => boolean;
  readOnly?: boolean;
  /** The stage column: a file dropped on it, or pasted into it, is attached here (15 Nov). */
  zone?: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageUrls = useProjectImageUrls();
  // Images wait for a caption before they are stored: the caption is what a
  // prompt is told the image shows, and a stored file is never edited.
  const [pending, setPending] = useState<{ file: File; caption: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Documents just attached whose words could go into the project context.
  const [readable, setReadable] = useState<{ name: string; text: string }[]>([]);

  const attach = async (picked: FileList | readonly File[] | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setReadable([]);
    try {
      // 17 Nov (Sean: "When a source changes …"): a document with the name of one already
      // attached is its new version. The old file goes; the new one takes its place, and its
      // words replace the old ones in the context, where the change check reads them.
      const chosen = Array.from(picked);
      const replacing = readOnly ? [] : files.filter((f) => f.preview.kind !== 'image' && chosen.some((c) => c.name === f.name && !isImage(c.name)));
      for (const old of replacing) await removeProjectFile(old);
      const replaced = new Set(replacing.map((f) => f.name));
      const prepared = await prepareFiles(chosen, files.map((f) => f.name).filter((n) => !replaced.has(n)));
      // A document too large to store keeps only its words (15 Nov): offered below for the context.
      for (const p of prepared.ready) if (storesFile(p)) await attachProjectFile(project, p.file, p.preview);
      if (prepared.errors.length) setError(prepared.errors.join(' '));
      const swapped = prepared.ready.filter((p) => replaced.has(p.file.name) && p.text && onReplaceInContext?.(p.file.name, p.text));
      const notes = [...prepared.notes, ...swapped.map((p) => t('data.replaced', { name: p.file.name }))];
      if (notes.length) setNote(notes.join(' '));
      setReadable(prepared.ready.flatMap((p) => (p.text && !swapped.includes(p) ? [{ name: p.file.name, text: p.text }] : [])));
      await onChanged();
    } catch (e) {
      setError(errorMessage(e) ? t('data.attachErrorWhy', { message: errorMessage(e) }) : t('data.attachError'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const pickImages = async (picked: FileList | readonly File[] | null) => {
    if (!picked?.length) return;
    setError(null);
    setNote(null);
    const chosen = Array.from(picked);
    if (imageInput.current) imageInput.current.value = '';
    setBusy(true);
    try {
      const names = [...files.map((f) => f.name), ...pending.map((p) => p.file.name)];
      const next: { file: File; caption: string }[] = [];
      const errors: string[] = [];
      const notes: string[] = [];
      for (const original of chosen) {
        // iPhone photos: HEIC to JPEG, and a large one scaled to fit (U1).
        const normal = await normalizeImage(original);
        if ('error' in normal) {
          errors.push(normal.error);
          continue;
        }
        if (normal.note) notes.push(normal.note);
        const file = normal.file;
        const reason = rejectReason(file.name, file.size, [...names, ...next.map((p) => p.file.name)]);
        if (reason) errors.push(reason);
        else next.push({ file, caption: imagePreview(file.name, '').caption ?? '' });
      }
      if (errors.length) setError(errors.join(' '));
      if (notes.length) setNote(notes.join(' '));
      setPending((prior) => [...prior, ...next]);
    } finally {
      setBusy(false);
    }
  };

  const attachImages = async () => {
    if (!pending.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const { file, caption } of pending) {
        let width = 0;
        let height = 0;
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width;
          height = bitmap.height;
          bitmap.close();
        } catch {
          // A format the browser cannot decode is still stored; its size is just unknown.
        }
        await attachProjectFile(project, file, imagePreview(file.name, caption, width, height));
      }
      setPending([]);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e) ? t('data.imageErrorWhy', { message: errorMessage(e) }) : t('data.imageError'));
    } finally {
      setBusy(false);
    }
  };

  // Dropped or pasted: pictures wait for a caption as picked ones do, the rest are attached.
  const dragging = useFileDrop(
    zone,
    (dropped) => {
      const pictures = dropped.filter((f) => isImage(f.name));
      const others = dropped.filter((f) => !isImage(f.name));
      if (pictures.length) void pickImages(pictures);
      if (others.length) void attach(others);
    },
    !readOnly && !busy && files.length < MAX_FILES,
    { pageWide: Boolean(zone) }
  );

  const images = files.filter((f) => f.preview.kind === 'image');
  const dataFiles = files.filter((f) => f.preview.kind !== 'image');

  const remove = async (file: ProjectFile) => {
    setBusy(true);
    setError(null);
    try {
      await removeProjectFile(file);
      await onChanged();
    } catch {
      setError(t('data.removeError', { name: file.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-panel="project-data" aria-label={t('data.label')} className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-4">
      {/* The panel may be scrolled out of view while a file is dragged over the stage, so the hint floats. */}
      {dragging && (
        <p role="status" data-drop-hint className="pointer-events-none fixed inset-x-0 bottom-6 z-50 mx-auto w-fit rounded-full bg-[var(--pm-primary)] px-4 py-2 text-label font-medium text-[var(--on-primary)] shadow-lg">
          {t('attach.dropHere')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">table_view</span>
        <h3 className="me-auto text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {t('data.title')}{files.length ? t('data.files', { count: files.length }) : ''}
        </h3>
        {!readOnly && files.length < MAX_FILES && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={PICKABLE_EXTENSIONS.filter((e) => !(IMAGE_EXTENSIONS as readonly string[]).includes(e)).join(',')}
              aria-label={t('data.attachDataLabel')}
              className="sr-only"
              onChange={(e) => void attach(e.target.files)}
            />
            <button
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t('data.working') : t('data.attachData')}
            </button>
            <input
              ref={imageInput}
              type="file"
              multiple
              accept={IMAGE_EXTENSIONS.join(',')}
              aria-label={t('data.addImages')}
              className="sr-only"
              onChange={(e) => pickImages(e.target.files)}
            />
            <button
              onClick={() => imageInput.current?.click()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {t('data.addImages')}
            </button>
          </>
        )}
      </div>

      {pending.length > 0 && (
        <div aria-label={t('data.toAdd')} role="group" className="mt-3 space-y-2 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          <p className="text-label text-[var(--on-surface-variant)]">
            {t('data.captionHint')}
          </p>
          {pending.map((p, i) => (
            <label key={`${p.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-body">
              <span className="min-w-[10rem] font-semibold text-[var(--on-surface)]">{p.file.name}</span>
              <input
                value={p.caption}
                maxLength={200}
                aria-label={t('data.captionFor', { name: p.file.name })}
                onChange={(e) => setPending((prior) => prior.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))}
                className="min-w-0 flex-1 rounded-md bg-[var(--surface-container-lowest)] px-3 py-1.5 text-body text-[var(--on-surface)] outline-none"
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button
              onClick={() => void attachImages()}
              disabled={busy}
              className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-50"
            >
              {busy ? t('data.adding') : pending.length === 1 ? t('data.addThis') : t('data.addThese', { count: pending.length })}
            </button>
            <button onClick={() => setPending([])} disabled={busy} className="px-2 text-label text-[var(--on-surface-variant)]">
              {t('data.cancel')}
            </button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <ul aria-label={t('data.images')} className="mt-3 flex flex-wrap gap-3">
          {images.map((file) => (
            <li key={file.id} className="w-[148px] text-label">
              {imageUrls[file.id] ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link
                <img src={imageUrls[file.id]} alt={file.preview.caption ?? file.name} className="h-[96px] w-full rounded-lg object-cover" />
              ) : (
                <span className="flex h-[96px] items-center justify-center rounded-lg bg-[var(--surface-container-low)]">
                  <span aria-hidden className="material-symbols-outlined text-[var(--on-surface-variant)]">image</span>
                </span>
              )}
              <span className="mt-1 block truncate text-[var(--on-surface)]" title={file.preview.caption}>{file.preview.caption ?? file.name}</span>
              {!readOnly && (
                <button
                  onClick={() => void remove(file)}
                  disabled={busy}
                  aria-label={t('data.removeNamed', { name: file.name })}
                  className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-50"
                >
                  {t('data.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          {t('data.imagesHint')}
        </p>
      )}

      {dataFiles.length === 0 ? (
        images.length === 0 && (
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            {t('data.empty', { mb: MAX_FILE_BYTES / 1_000_000 })}
          </p>
        )
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {dataFiles.map((file) => (
              <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-body">
                <span className="font-semibold text-[var(--on-surface)]">{file.name}</span>
                <span className="me-auto text-label text-[var(--on-surface-variant)]">{describePreview(file.preview)}</span>
                {!readOnly && (
                  <button
                    onClick={() => void remove(file)}
                    disabled={busy}
                    aria-label={t('data.removeNamed', { name: file.name })}
                    className="text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-50"
                  >
                    {t('data.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            {t('data.codeReads')}
          </p>
        </>
      )}

      {readable.length > 0 && onAddToContext && !readOnly && (
        <div role="group" aria-label={t('data.addText')} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5">
          <span className="me-auto text-label text-[var(--on-surface-variant)]">
            {readable.length === 1 ? t('data.oneHasText', { name: readable[0].name }) : t('data.manyHaveText', { count: readable.length })}
          </span>
          <button
            onClick={() => {
              onAddToContext(readable);
              setNote(t('data.added', { names: readable.map((r) => r.name).join(', ') }));
              setReadable([]);
            }}
            className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)]"
          >
            {t('data.addToContext')}
          </button>
          <button onClick={() => setReadable([])} className="px-2 text-label text-[var(--on-surface-variant)]">
            {t('data.notNow')}
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>
      )}
    </section>
  );
}
