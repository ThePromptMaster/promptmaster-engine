'use client';

import { useRef, useState } from 'react';

import { IMAGE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES, PICKABLE_EXTENSIONS, describePreview, imagePreview, rejectReason } from '@/lib/data/preview';
import { prepareFiles } from '@/lib/data/attachments';
import { useProjectImageUrls } from '@/components/shared/project-images';
import { attachProjectFile, removeProjectFile } from '@/lib/supabase/project-files';
import { ADD_IMAGES_LABEL, ATTACH_DATA_LABEL } from '@/lib/workflow/stage-controls';
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
      setError(e instanceof Error && e.message ? `Could not attach the file: ${e.message}` : 'Could not attach the file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const pickImages = (picked: FileList | null) => {
    if (!picked?.length) return;
    setError(null);
    const names = [...files.map((f) => f.name), ...pending.map((p) => p.file.name)];
    const next: { file: File; caption: string }[] = [];
    for (const file of Array.from(picked)) {
      const reason = rejectReason(file.name, file.size, [...names, ...next.map((p) => p.file.name)]);
      if (reason) setError(reason);
      else next.push({ file, caption: imagePreview(file.name, '').caption ?? '' });
    }
    setPending((prior) => [...prior, ...next]);
    if (imageInput.current) imageInput.current.value = '';
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
      setError(e instanceof Error && e.message ? `Could not add the image: ${e.message}` : 'Could not add the image.');
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
      setError(`Could not remove ${file.name}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Project data" className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">table_view</span>
        <h3 className="mr-auto text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          Data and images{files.length ? ` · ${files.length} file${files.length === 1 ? '' : 's'}` : ''}
        </h3>
        {!readOnly && files.length < MAX_FILES && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={PICKABLE_EXTENSIONS.filter((e) => !(IMAGE_EXTENSIONS as readonly string[]).includes(e)).join(',')}
              aria-label="Attach data files"
              className="sr-only"
              onChange={(e) => void attach(e.target.files)}
            />
            <button
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : ATTACH_DATA_LABEL}
            </button>
            <input
              ref={imageInput}
              type="file"
              multiple
              accept={IMAGE_EXTENSIONS.join(',')}
              aria-label="Add images"
              className="sr-only"
              onChange={(e) => pickImages(e.target.files)}
            />
            <button
              onClick={() => imageInput.current?.click()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {ADD_IMAGES_LABEL}
            </button>
          </>
        )}
      </div>

      {pending.length > 0 && (
        <div aria-label="Images to add" role="group" className="mt-3 space-y-2 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          <p className="text-label text-[var(--on-surface-variant)]">
            Say what each image shows. PromptMaster cannot see images; it places them in your work by what the caption says.
          </p>
          {pending.map((p, i) => (
            <label key={`${p.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-body">
              <span className="min-w-[10rem] font-semibold text-[var(--on-surface)]">{p.file.name}</span>
              <input
                value={p.caption}
                maxLength={200}
                aria-label={`Caption for ${p.file.name}`}
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
              {busy ? 'Adding…' : `Add ${pending.length === 1 ? 'this image' : `these ${pending.length} images`}`}
            </button>
            <button onClick={() => setPending([])} disabled={busy} className="px-2 text-label text-[var(--on-surface-variant)]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <ul aria-label="Images" className="mt-3 flex flex-wrap gap-3">
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
                  aria-label={`Remove ${file.name}`}
                  className="text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          Drafts can place these where they help; in an edit, “Insert image” puts one where your cursor is.
        </p>
      )}

      {dataFiles.length === 0 ? (
        images.length === 0 && (
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            No data or images attached. Without data, analyses can be planned but not run, and PromptMaster will say so.
            Attach CSV, TSV, JSON or text files, or an Excel workbook (.xlsx, converted to CSV), and Go can run code
            against them. Attach a PDF or Word brief and its text can go into the project context. Add photos or figures (PNG, JPEG, WebP, GIF) to place them in your work. Up to{' '}
            {MAX_FILE_BYTES / 1_000_000} MB each.
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
                    aria-label={`Remove ${file.name}`}
                    className="text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            Code that Go runs can read these. PromptMaster is shown each file&apos;s columns and first rows, not the file.
          </p>
        </>
      )}

      {readable.length > 0 && onAddToContext && !readOnly && (
        <div role="group" aria-label="Add document text" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-2.5">
          <span className="mr-auto text-label text-[var(--on-surface-variant)]">
            {readable.length === 1 ? `${readable[0].name} has text` : `${readable.length} documents have text`} every stage could quote.
          </span>
          <button
            onClick={() => {
              onAddToContext(readable);
              setNote(`Added to the project context: ${readable.map((r) => r.name).join(', ')}.`);
              setReadable([]);
            }}
            className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)]"
          >
            Add its text to the project context
          </button>
          <button onClick={() => setReadable([])} className="px-2 text-label text-[var(--on-surface-variant)]">
            Not now
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
