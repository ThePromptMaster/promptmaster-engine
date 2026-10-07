'use client';

import { useRef, useState } from 'react';

import { documentsOf, prepareFiles } from '@/lib/data/attachments';
import { PICKABLE_EXTENSIONS, isImage } from '@/lib/data/preview';
import { attachProjectFile } from '@/lib/supabase/project-files';
import type { Project } from '@/types/project';

/**
 * Attaching a file from the side chat (6 Oct, email 9: "Attachments aren't
 * working"). The chat is where people reach for a paperclip, and it had none.
 *
 * It stores the file exactly as the project's data panel does — same checks,
 * same `project_files` row — and then asks before a document's words go into
 * the project context. Nothing is attached to a message: the chat reads the
 * project, so the file is the project's from the moment it is stored.
 */
export function ChatAttach({
  project,
  existingNames,
  onChanged,
  onAddToContext,
  disabled = false,
}: {
  project: Pick<Project, 'id' | 'user_id'>;
  existingNames: readonly string[];
  onChanged: () => void | Promise<void>;
  onAddToContext?: (documents: { name: string; text: string }[]) => void;
  disabled?: boolean;
}) {
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
          failed.push(`${p.file.name} could not be stored${e instanceof Error && e.message ? ` (${e.message})` : ''}.`);
        }
      }
      if (images.length) failed.push(`Images need a caption: add ${images.length === 1 ? 'it' : 'them'} with "Add images" on the page.`);
      setReadable(documentsOf(prepared.ready.filter((p) => stored.includes(p.file.name))));
      setMessage(
        [stored.length ? `Attached to the project: ${stored.join(', ')}.` : '', ...prepared.notes, ...failed]
          .filter(Boolean)
          .join(' ')
      );
      if (stored.length) await onChanged();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        ref={input}
        type="file"
        multiple
        accept={PICKABLE_EXTENSIONS.join(',')}
        className="hidden"
        aria-label="Attach a file to the project"
        onChange={(e) => void attach(e.target.files)}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || busy}
        title="Attach a file to the project"
        className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-1 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[18px]">attach_file</span>
        {busy ? 'Attaching…' : 'Attach'}
      </button>
      {message && (
        <p role="status" className="text-label text-[var(--on-surface-variant)]">
          {message}
        </p>
      )}
      {readable.length > 0 && onAddToContext && (
        <button
          type="button"
          onClick={() => {
            onAddToContext(readable);
            setReadable([]);
            setMessage('Added to the project context — every stage can quote it.');
          }}
          className="self-start rounded-lg bg-[var(--surface-container-high)] px-3 py-1 text-label text-[var(--on-surface)]"
        >
          Add its text to the project context
        </button>
      )}
    </div>
  );
}
