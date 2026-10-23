'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useRef, useState } from 'react';

import { IMAGE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES, PICKABLE_EXTENSIONS, describePreview, imagePreview, rejectReason } from '@/lib/data/preview';
import { prepareFiles } from '@/lib/data/attachments';
import { normalizeImage } from '@/lib/data/normalize-image';
import { useProjectImageUrls } from '@/components/shared/project-images';
import { attachProjectFile, removeProjectFile } from '@/lib/supabase/project-files';
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
  readOnly = false,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  files: ProjectFile[];
  onChanged: () => void | Promise<void>;
  /** A document's words into the project context, when the user says so. */
  onAddToContext?: (documents: { name: string; text: string }[]) => void;
  readOnly?: boolean;
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

  const attach = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setReadable([]);
    try {
      const prepared = await prepareFiles(Array.from(picked), files.map((f) => f.name));
      for (const { file, preview } of prepared.ready) await attachProjectFile(project, file, preview);
      if (prepared.errors.length) setError(prepared.errors.join(' '));
      if (prepared.notes.length) setNote(prepared.notes.join(' '));
      setReadable(prepared.ready.flatMap((p) => (p.text ? [{ name: p.file.name, text: p.text }] : [])));
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? t('data.attachErrorWhy', { message: e.message }) : t('data.attachError'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const pickImages = async (picked: FileList | null) => {
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
      setError(e instanceof Error && e.message ? t('data.imageErrorWhy', { message: e.message }) : t('data.imageError'));
    } finally {
      setBusy(false);
    }
  };

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
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">table_view</span>
        <h3 className="mr-auto text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
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
                <span className="mr-auto text-label text-[var(--on-surface-variant)]">{describePreview(file.preview)}</span>
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
          <span className="mr-auto text-label text-[var(--on-surface-variant)]">
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
