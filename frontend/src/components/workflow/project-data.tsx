'use client';

import { useRef, useState } from 'react';

import { MAX_FILE_BYTES, MAX_FILES, PICKABLE_EXTENSIONS, describePreview, isSpreadsheet, previewOf, rejectReason } from '@/lib/data/preview';
import { spreadsheetToCsvFiles } from '@/lib/data/spreadsheet';
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
  readOnly = false,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  files: ProjectFile[];
  onChanged: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const attach = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const names = files.map((f) => f.name);
    try {
      for (const original of Array.from(picked)) {
        // A spreadsheet is attached as one CSV per sheet: that is what the
        // preview, the model and the code that runs can all read.
        let parts = [original];
        if (isSpreadsheet(original.name)) {
          if (original.size > MAX_FILE_BYTES) {
            setError(`${original.name} is larger than ${MAX_FILE_BYTES / 1_000_000} MB.`);
            continue;
          }
          try {
            parts = await spreadsheetToCsvFiles(original);
          } catch {
            setError(`${original.name} could not be read as a spreadsheet. Save it as CSV and attach that.`);
            continue;
          }
          if (!parts.length) {
            setError(`${original.name} has no sheet with anything in it.`);
            continue;
          }
          setNote(
            `${original.name} was converted to CSV — ${parts.length === 1 ? 'one file' : `${parts.length} files, one per sheet`}. ` +
              'Values are kept; formulas arrive as their results, and formatting and charts are left behind.'
          );
        }
        for (const file of parts) {
          const reason = rejectReason(file.name, file.size, names);
          if (reason) {
            setError(reason);
            continue;
          }
          await attachProjectFile(project, file, previewOf(file.name, await file.text()));
          names.push(file.name);
        }
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? `Could not attach the file: ${e.message}` : 'Could not attach the file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

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
          Data{files.length ? ` · ${files.length} file${files.length === 1 ? '' : 's'}` : ''}
        </h3>
        {!readOnly && files.length < MAX_FILES && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={PICKABLE_EXTENSIONS.join(',')}
              aria-label="Attach data files"
              className="sr-only"
              onChange={(e) => void attach(e.target.files)}
            />
            <button
              onClick={() => input.current?.click()}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Attach a data file'}
            </button>
          </>
        )}
      </div>

      {files.length === 0 ? (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          No data attached. Without data, analyses can be planned but not run, and PromptMaster will say so. Attach CSV,
          TSV, JSON or text files, or an Excel workbook (.xlsx, converted to CSV), up to {MAX_FILE_BYTES / 1_000_000} MB
          each, and Go can run code against them.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {files.map((file) => (
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

      {note && (
        <p role="status" className="mt-2 text-label text-[var(--on-surface-variant)]">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>
      )}
    </section>
  );
}
