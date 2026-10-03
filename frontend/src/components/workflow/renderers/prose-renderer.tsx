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
import { useProjectImageList } from '@/components/shared/project-images';
import { imageMarkdown } from '@/lib/data/images';
import { ConfirmOverwrite, EmptyStage, GenerationBar, VersionBar } from './stage-chrome';
import type { StageRendererProps } from './types';
import { operationLabel } from '@/lib/workflow/labels';

export function ProseRenderer({
  stage,
  hideStageActions = false,
  onDirtyChange,
  versions,
  evaluation,
  activeVersionId,
  onSelectVersion,
  onRestore,
  onSaveContent,
  generating,
  generationError,
  generationFailure,
  evaluationFailure,
  onDismissFailure,
  onSwitchModel,
  currentModel,
  onGenerate,
  onCancelGeneration,
  onEvaluate,
  evaluating,
  evaluationError,
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const images = useProjectImageList();
  const [choosingImage, setChoosingImage] = useState(false);

  /** Put an image on its own line where the cursor is (3 Oct call: photos in the work). */
  const insertImage = (image: (typeof images)[number]) => {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : draft.length;
    const before = draft.slice(0, at);
    const after = draft.slice(at);
    const tag = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}${imageMarkdown(image)}\n\n`;
    setDraft(before + tag + after);
    setChoosingImage(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tag.length, at + tag.length);
    });
  };

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

  // PM-06: tell the workspace about unsaved edits, so "Save changes" can lead.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    onDirtyChange?.({ dirty, save: () => saveRef.current() });
  }, [dirty, onDirtyChange]);

  function startEditing() {
    setDraft(content);
    setEditing(true);
  }

  async function save() {
    if (!onSaveContent || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Saving appends a version rather than overwriting one. Every edit is
      // recoverable, and the provenance chain stays unbroken.
      await onSaveContent(draft);
      setEditing(false);
    } catch (e) {
      // Used to fail silently, leaving the editor open with no word of why.
      // The draft stays in the editor, so nothing typed is lost.
      setSaveError(
        `Not saved${e instanceof Error && e.message ? `: ${e.message}` : ''}. Your text is still here — try again.`
      );
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
    <section aria-label={`${stage.label} work`}>
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
        compact={hideStageActions}
        label={label}
        generating={generating}
        error={generationError}
        hasContent={content.trim().length > 0}
        onGenerate={requestGenerate}
        onCancel={onCancelGeneration}
        onEvaluate={onEvaluate}
        evaluating={evaluating}
        evaluationError={evaluationError}
        failure={generationFailure}
        evaluationFailure={evaluationFailure}
        onDismissFailure={onDismissFailure}
        onSwitchModel={onSwitchModel}
        currentModel={currentModel}
        readOnly={readOnly}
      />

      <VersionBar
          evaluation={evaluation}
        versions={versions}
        activeVersionId={activeVersionId}
        headVersionId={versions.at(-1)?.id ?? null}
        onSelect={onSelectVersion}
        onRestore={onRestore}
        readOnly={readOnly}
      />

      {!active && !generating && !editing && (
        <EmptyStage
          label={label}
          // "Draft one, or write it yourself" — with no way to write it, when the
          // stage had never been drafted (or the draft failed).
          onWrite={!readOnly && onSaveContent ? startEditing : undefined}
        />
      )}

      {(active || editing) && (
        <article className="rounded-xl bg-[var(--surface-container-lowest)] px-7 py-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-label text-[var(--on-surface-variant)]">
              {active ? operationLabel(active.source_operation) : 'Your draft'}
            </span>
            {active?.model && (
              <>
                <span aria-hidden className="text-label text-[var(--on-surface-variant)]">
                  ·
                </span>
                <span className="text-label text-[var(--on-surface-variant)]">{active?.model}</span>
              </>
            )}

            {!readOnly && onSaveContent && (
              <div className="ml-auto flex items-center gap-2">
                {editing ? (
                  <>
                    {images.length > 0 && !preview && (
                      <div className="relative">
                        <button
                          onClick={() => setChoosingImage((v) => !v)}
                          aria-expanded={choosingImage}
                          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
                        >
                          <span aria-hidden className="material-symbols-outlined text-[16px]">image</span>
                          Insert image
                        </button>
                        {choosingImage && (
                          <ul role="menu" aria-label="Images" className="absolute right-0 z-10 mt-1 w-64 rounded-lg bg-[var(--surface-container-lowest)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                            {images.map((image) => (
                              <li key={image.id}>
                                <button
                                  role="menuitem"
                                  onClick={() => insertImage(image)}
                                  className="block w-full truncate px-3 py-2 text-left text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                                >
                                  {image.caption}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
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

          {active?.change_summary && !editing && (
            <p className="mb-5 text-body italic text-[var(--on-surface-variant)]">
              {active.change_summary}
            </p>
          )}

          {saveError && (
            <p role="alert" className="mb-4 rounded-lg bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
              {saveError}
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
