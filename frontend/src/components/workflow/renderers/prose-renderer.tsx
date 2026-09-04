'use client';

/**
 * Prose stages: an objective statement, a positioning statement, an editing
 * pass.
 *
 * The read view, version pills and Restore are adapted from the project page,
 * which had them for a single-output project. The **editor is new** — until
 * now every textarea in this app was input *to* the model, and none of them
 * edited its output. "AI drafts on entry, the user edits" does not work
 * without one.
 *
 * The editor is a textarea with a preview toggle rather than a rich editor.
 * The artifact is Markdown, the model writes Markdown, and a WYSIWYG layer
 * that round-trips Markdown badly would corrupt the thing being versioned.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';

export function ProseRenderer({
  stage,
  versions,
  activeVersionId,
  onSelectVersion,
  onRestore,
  onSaveContent,
  generating,
  generationError,
  onGenerate,
  onCancelGeneration,
  readOnly,
}: StageRendererProps) {
  const active = useMemo(
    () => versions.find((v) => v.id === activeVersionId) ?? versions.at(-1) ?? null,
    [versions, activeVersionId]
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Leaving edit mode when the underlying version changes under you (a
  // generation landed, or another tab appended) is safer than silently
  // rebasing an edit onto content the user has not seen.
  const activeId = active?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setPreview(false);
  }, [activeId]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const content = active?.content ?? '';
  const dirty = editing && draft !== content;
  const label = stage.short_label.toLowerCase();

  function startEditing() {
    setDraft(content);
    setEditing(true);
  }

  async function save() {
    if (!onSaveContent || !dirty || saving) return;
    setSaving(true);
    try {
      // Saving appends a version rather than overwriting one. Every edit is
      // recoverable, and the provenance chain stays unbroken.
      await onSaveContent(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function requestGenerate() {
    // Never replace work without asking. The old version survives in history,
    // but finding that out afterwards is not the same as being asked.
    if (content.trim() || dirty) setConfirming(true);
    else onGenerate();
  }

  return (
    <section aria-label={`${stage.label} artifact`}>
      {confirming && (
        <ConfirmOverwrite
          label={label}
          onConfirm={() => {
            setConfirming(false);
            setEditing(false);
            onGenerate({ force: true });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      <GenerationBar
        label={label}
        generating={generating}
        error={generationError}
        hasContent={content.trim().length > 0}
        onGenerate={requestGenerate}
        onCancel={onCancelGeneration}
        readOnly={readOnly}
      />

      <VersionBar
        versions={versions}
        activeVersionId={activeVersionId}
        headVersionId={versions.at(-1)?.id ?? null}
        onSelect={onSelectVersion}
        onRestore={onRestore}
        readOnly={readOnly}
      />

      {!active && !generating && <EmptyStage label={label} />}

      {active && (
        <article className="rounded-xl bg-[var(--surface-container-lowest)] px-7 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-label text-[var(--on-surface-variant)]">
              {active.source_operation}
            </span>
            {active.model && (
              <>
                <span aria-hidden className="text-label text-[var(--on-surface-variant)]">
                  ·
                </span>
                <span className="text-label text-[var(--on-surface-variant)]">{active.model}</span>
              </>
            )}

            {!readOnly && onSaveContent && (
              <div className="ml-auto flex items-center gap-2">
                {editing ? (
                  <>
                    <button
                      onClick={() => setPreview((p) => !p)}
                      aria-pressed={preview}
                      className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
                    >
                      {preview ? 'Write' : 'Preview'}
                    </button>
                    <button
                      onClick={() => void save()}
                      disabled={!dirty || saving}
                      className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
                    >
                      {saving ? 'Saving…' : 'Save as new version'}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEditing}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
                  >
                    <span aria-hidden className="material-symbols-outlined text-[16px]">
                      edit
                    </span>
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>

          {active.change_summary && !editing && (
            <p className="mb-5 text-body italic text-[var(--on-surface-variant)]">
              {active.change_summary}
            </p>
          )}

          {editing && !preview ? (
            <>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`Edit ${stage.label}`}
                rows={18}
                className="w-full resize-y rounded-lg bg-[var(--surface-container-low)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
              />
              <p className="mt-2 text-label text-[var(--on-surface-variant)]">
                Markdown. {dirty ? 'Unsaved changes.' : 'No changes yet.'}
              </p>
            </>
          ) : (
            <MarkdownOutput content={editing ? draft : content} />
          )}
        </article>
      )}
    </section>
  );
}
