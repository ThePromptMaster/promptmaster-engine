'use client';

import { useRef, useState } from 'react';

import { prepareFiles, type PreparedFile } from '@/lib/data/attachments';
import { normalizeImage } from '@/lib/data/normalize-image';
import { MAX_FILES, PICKABLE_EXTENSIONS, describePreview, imagePreview, isImage, rejectReason } from '@/lib/data/preview';

/** An image waiting to be stored, with what the user says it shows. */
export interface StartImage {
  file: File;
  caption: string;
}

/**
 * Attachments on the start screen (5 Oct, email 8: "should we put the
 * attachment/image stuff in the beginning screen so it recognizes it when
 * creating prompt?").
 *
 * A project's files are stored under its id, so nothing is uploaded here: the
 * files are held until Start, and a document's words are read straight away so
 * the recommended setup and the Guide questions can use them.
 */
export function StartAttachments({
  files,
  images,
  onFiles,
  onImages,
  disabled = false,
}: {
  files: PreparedFile[];
  images: StartImage[];
  onFiles: (files: PreparedFile[]) => void;
  onImages: (images: StartImage[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const names = [...files.map((f) => f.file.name), ...images.map((i) => i.file.name)];

  const pick = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const all = Array.from(picked);
      const pictures = all.filter((f) => isImage(f.name));
      const prepared = await prepareFiles(all.filter((f) => !isImage(f.name)), names);
      const errors = [...prepared.errors];
      const taken = [...names, ...prepared.ready.map((p) => p.file.name)];
      const nextImages: StartImage[] = [];
      const notes = [...prepared.notes];
      for (const picked of pictures) {
        // iPhone photos: HEIC to JPEG, and a large one scaled to fit (U1).
        const normal = await normalizeImage(picked);
        if ('error' in normal) {
          errors.push(normal.error);
          continue;
        }
        const file = normal.file;
        if (normal.note) notes.push(normal.note);
        const reason = rejectReason(file.name, file.size, taken);
        if (reason) errors.push(reason);
        else {
          nextImages.push({ file, caption: imagePreview(file.name, '').caption ?? '' });
          taken.push(file.name);
        }
      }
      if (prepared.ready.length) onFiles([...files, ...prepared.ready]);
      if (nextImages.length) onImages([...images, ...nextImages]);
      if (errors.length) setError(errors.join(' '));
      if (notes.length) setNote(notes.join(' '));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const count = files.length + images.length;

  return (
    <div aria-label="Attachments" role="group" className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={[...PICKABLE_EXTENSIONS].join(',')}
          aria-label="Attach files"
          className="sr-only"
          onChange={(e) => void pick(e.target.files)}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || busy || count >= MAX_FILES}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">attach_file</span>
          {busy ? 'Reading…' : 'Attach a brief, data or images'}
        </button>
        <span className="text-label text-[var(--on-surface-variant)]">
          PDF, Word, text, spreadsheets, CSV or images. A brief&apos;s text is read before the setup is suggested.
        </span>
      </div>

      {count > 0 && (
        <ul aria-label="Attached" className="mt-3 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.file.name}-${i}`} className="flex flex-wrap items-baseline gap-x-3 text-body">
              <span className="font-semibold text-[var(--on-surface)]">{f.file.name}</span>
              <span className="mr-auto text-label text-[var(--on-surface-variant)]">
                {f.text ? `${f.text.length.toLocaleString('en-US')} characters of text · goes into the project context` : describePreview(f.preview)}
              </span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.file.name}`}
                className="text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                Remove
              </button>
            </li>
          ))}
          {images.map((img, i) => (
            <li key={`${img.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-body">
              <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">image</span>
              <span className="font-semibold text-[var(--on-surface)]">{img.file.name}</span>
              <input
                value={img.caption}
                maxLength={200}
                aria-label={`Caption for ${img.file.name}`}
                placeholder="What it shows"
                onChange={(e) => onImages(images.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))}
                className="min-w-0 flex-1 rounded-md bg-[var(--surface-container-low)] px-3 py-1 text-body text-[var(--on-surface)] outline-none"
              />
              <button
                type="button"
                onClick={() => onImages(images.filter((_, j) => j !== i))}
                aria-label={`Remove ${img.file.name}`}
                className="text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          PromptMaster cannot see images; it places them by what the caption says.
        </p>
      )}
      {note && <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">{note}</p>}
      {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
    </div>
  );
}
