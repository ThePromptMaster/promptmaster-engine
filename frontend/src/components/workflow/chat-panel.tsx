'use client';

/**
 * The side chat (FR-08), in the workspace rather than beside it.
 *
 * Section 8 of the UX requirements asks for the main workspace to integrate
 * "project state, artifact, side chat, recommendations, evaluation, and
 * versions without forcing users through disconnected product paths", and for
 * the chat itself to support two things: "discussion that does not modify the
 * artifact and modification instructions that can be applied to a selected
 * scope".
 *
 * **The mode distinction is the design.** Everything visible here exists to
 * answer one question before the user presses anything: *is this going to
 * change my document?* So the two modes are a segmented control rather than a
 * checkbox, each carries its consequence in words underneath it, the send
 * button is labelled with what it does ("Ask" / "Draft revision") rather than
 * "Send", and the composer's tint follows the mode. A user who cannot tell the
 * difference at a glance will not use the feature — or worse, will use it and
 * be surprised.
 *
 * Instruct never writes on its own. It drafts, shows the exact passage that
 * would change (FR-09: "the affected scope is shown before application"), and
 * waits. Accept appends; Discard leaves the artifact untouched; Restore puts
 * the previous version back. Those are FR-08's three verbs, and all three are
 * reachable from this panel.
 *
 * The panel is presentation and input. Endpoints, persistence and the mode
 * boundary itself live in `use-stage-chat.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { useStageChat } from './use-stage-chat';
import { documentSections, type ScopeKind } from './chat-scope';
import type { StageChatMessage } from '@/lib/supabase/conversation';
import type { NewVersion } from '@/lib/supabase/versions';
import type { ArtifactVersion, Project } from '@/types/project';

type Mode = 'discuss' | 'instruct';

const MODES: Array<{
  key: Mode;
  label: string;
  icon: string;
  /** The consequence, stated. This is the whole point of the control. */
  promise: string;
  send: string;
  placeholder: string;
}> = [
  {
    key: 'discuss',
    label: 'Discuss',
    icon: 'forum',
    promise: 'Asks a question and gets an answer. Your document is not changed.',
    send: 'Ask',
    placeholder: 'Ask about this draft — nothing you write here changes it.',
  },
  {
    key: 'instruct',
    label: 'Instruct',
    icon: 'edit_note',
    promise: 'Drafts a revision. You see exactly what would change before it is applied.',
    send: 'Draft revision',
    placeholder: 'Say what to change — for example, “cut the second paragraph in half”.',
  },
];

interface Props {
  project: Project;
  stageId: string;
  stageLabel: string;
  /** The content a scope resolves against — the version on screen. */
  content: string;
  headVersion: ArtifactVersion | null;
  appendStageVersion?: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<unknown>;
  restoreStageVersion?: (stageId: string, versionId: string) => Promise<void>;
  /**
   * Browsing an earlier stage. The thread stays readable — it is a record of
   * what was discussed — but nothing can be sent into a stage that has moved on.
   */
  readOnly?: boolean;
  /** Which mode to open in. Discuss, unless a caller says otherwise. */
  initialMode?: Mode;
  /**
   * False when the version on screen is not the stage's latest.
   *
   * Instruct splices its revision into the content it was given and appends
   * the result, so revising while reading version 1 of a stage that is on
   * version 3 would append a version 4 built from version 1 — silently
   * discarding two versions of work. Discussion is unaffected: asking about an
   * old version is a reasonable thing to do.
   */
  canInstruct?: boolean;
}

export function ChatPanel({
  project,
  stageId,
  stageLabel,
  content,
  headVersion,
  appendStageVersion,
  restoreStageVersion,
  readOnly = false,
  initialMode = 'discuss',
  canInstruct = true,
}: Props) {
  const chat = useStageChat({
    project,
    stageId,
    stageLabel,
    content,
    headVersion,
    appendStageVersion,
    restoreStageVersion,
  });

  const [requestedMode, setMode] = useState<Mode>(initialMode);
  // Derived, not corrected after the fact: there is no render in which the
  // composer offers a power the panel will not honour.
  const mode: Mode = canInstruct ? requestedMode : 'discuss';
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<ScopeKind>('document');
  const [sectionId, setSectionId] = useState<string>('');
  const [selection, setSelection] = useState('');

  const panelRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => documentSections(content), [content]);
  const spec = MODES.find((m) => m.key === mode)!;

  /**
   * The section actually targeted.
   *
   * Derived rather than synced into state by an effect: the section list is a
   * function of the content, so a stored id can go stale the moment a new
   * version lands — and an effect that repairs it afterwards leaves a render in
   * between where the picker points at a section that no longer exists.
   */
  const effectiveSectionId =
    sections.find((s) => s.id === sectionId)?.id ?? sections[0]?.id ?? '';

  /**
   * Track what the user has selected in the artifact.
   *
   * Read from the live document selection rather than from a prop, because the
   * artifact is rendered by whichever renderer the stage declares and none of
   * them know this panel exists — threading a selection callback through the
   * renderer contract would give every renderer a chat it has no business
   * knowing about. Selections made inside the panel itself are ignored: this
   * is about the document, not about re-reading the thread.
   */
  useEffect(() => {
    function read() {
      const active = document.getSelection();
      if (!active || active.isCollapsed) return;
      if (panelRef.current && active.anchorNode && panelRef.current.contains(active.anchorNode)) {
        return;
      }
      const text = active.toString().trim();
      if (text) setSelection(text);
    }
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  // Follow the conversation as it grows, but only the thread — scrolling the
  // page out from under someone reading their artifact would be worse than
  // making them scroll the panel.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.proposal]);

  const scopeReady =
    scope === 'document'
      ? content.trim().length > 0
      : scope === 'section'
        ? sections.length > 0
        : selection.length > 0;

  const canSend =
    !readOnly && !chat.busy && draft.trim().length > 0 && (mode === 'discuss' || scopeReady);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    // Cleared up front: a message the user has to delete by hand before typing
    // the next one reads as a failure even when it succeeded.
    setDraft('');
    if (mode === 'discuss') {
      await chat.discuss(text);
    } else {
      await chat.propose(text, scope, { selection, sectionId: effectiveSectionId });
    }
  }, [draft, mode, scope, selection, effectiveSectionId, chat]);

  return (
    <section
      ref={panelRef}
      aria-label="Side chat"
      className="flex h-full min-h-0 flex-col rounded-xl bg-[var(--surface-container-lowest)]"
    >
      <header className="px-5 pt-5">
        <h2 className="text-title text-[var(--on-surface)]">Side chat</h2>
        <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{stageLabel}</p>
      </header>

      <ModeSwitch
        mode={mode}
        onChange={setMode}
        disabled={readOnly}
        instructDisabledReason={
          canInstruct
            ? null
            : 'You are reading an earlier version. Open the latest one to revise it.'
        }
      />

      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sidebar-scroll"
        aria-live="polite"
      >
        {chat.loading ? (
          <p className="text-label text-[var(--on-surface-variant)]">Loading the thread…</p>
        ) : chat.messages.length === 0 ? (
          <EmptyThread mode={mode} />
        ) : (
          <ol className="space-y-4">
            {chat.messages.map((message) => (
              <li key={message.id}>
                <Bubble message={message} />
              </li>
            ))}
          </ol>
        )}

        {chat.busy && (
          <p className="mt-4 text-label text-[var(--on-surface-variant)]">
            {mode === 'discuss' ? 'Thinking…' : 'Drafting the revision…'}
          </p>
        )}

        {chat.proposal && (
          <ProposalCard
            scopeLabel={chat.proposal.target.label}
            before={chat.proposal.before}
            after={chat.proposal.after}
            canApply={chat.canApply}
            busy={chat.busy}
            onAccept={() => void chat.accept()}
            onDiscard={chat.discard}
          />
        )}

        {chat.applied && (
          <AppliedNotice
            scope={chat.applied.scope}
            canUndo={chat.canUndo && Boolean(chat.applied.previousVersionId)}
            busy={chat.busy}
            onUndo={() => void chat.undo()}
            onDismiss={chat.dismissApplied}
          />
        )}
      </div>

      {chat.error && (
        <p role="alert" className="px-5 pb-2 text-label text-[var(--pm-error)]">
          {chat.error}
        </p>
      )}

      {!readOnly && (
        <div className="px-5 pb-5">
          {mode === 'instruct' && (
            <ScopePicker
              scope={scope}
              onScope={setScope}
              sections={sections}
              sectionId={effectiveSectionId}
              onSection={setSectionId}
              selection={selection}
              hasContent={content.trim().length > 0}
            />
          )}

          <div
            className={`rounded-xl px-3 py-2 ${
              mode === 'instruct'
                ? 'bg-[var(--surface-container-high)]'
                : 'bg-[var(--surface-container-low)]'
            }`}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (canSend) void send();
                }
              }}
              rows={3}
              aria-label={mode === 'discuss' ? 'Ask a question' : 'Give a revision instruction'}
              placeholder={spec.placeholder}
              className="w-full resize-y bg-transparent text-body text-[var(--on-surface)] outline-none placeholder:text-[var(--on-surface-variant)]"
            />
            <div className="mt-1 flex items-center gap-2">
              <span className="text-label text-[var(--on-surface-variant)]">{spec.promise}</span>
              <button
                onClick={() => void send()}
                disabled={!canSend}
                className="ml-auto shrink-0 rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
              >
                {spec.send}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The mode control.
 *
 * A segmented pair, not a toggle: a toggle shows one state and hides the
 * other, so the user has to already know what the alternative was. Both
 * consequences are on screen the whole time.
 */
function ModeSwitch({
  mode,
  onChange,
  disabled,
  instructDisabledReason,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled: boolean;
  /** Present when Instruct is unavailable — and then it says why. */
  instructDisabledReason: string | null;
}) {
  return (
    <div className="px-5 pt-4">
      <div role="tablist" aria-label="Chat mode" className="flex gap-1.5">
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <button
              key={m.key}
              role="tab"
              aria-selected={active}
              disabled={disabled || (m.key === 'instruct' && Boolean(instructDisabledReason))}
              onClick={() => onChange(m.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-label disabled:opacity-40 ${
                active
                  ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                  : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">
                {m.icon}
              </span>
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Stated, not implied. The one thing a user must never be unsure of is
          whether the box they are typing into edits their work. */}
      <p
        className={`mt-2 flex items-start gap-1.5 text-label ${
          mode === 'discuss' ? 'text-[var(--pm-success)]' : 'text-[var(--on-surface-variant)]'
        }`}
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          {mode === 'discuss' ? 'lock' : 'rate_review'}
        </span>
        <span>
          {mode === 'discuss'
            ? 'Discussion only — this mode cannot change your document.'
            : 'Revisions are shown for review first, and never replace a version.'}
        </span>
      </p>

      {instructDisabledReason && (
        <p className="mt-1.5 text-label text-[var(--pm-tertiary)]">{instructDisabledReason}</p>
      )}
    </div>
  );
}

function EmptyThread({ mode }: { mode: Mode }) {
  return (
    <p className="text-body text-[var(--on-surface-variant)]">
      {mode === 'discuss'
        ? 'Ask anything about this draft — what it assumes, what it leaves out, whether it suits the audience. Nothing here edits it.'
        : 'Describe a change and choose what it should apply to. You will see the exact passage before anything is written.'}
    </p>
  );
}

function Bubble({ message }: { message: StageChatMessage }) {
  const mine = message.role === 'user';
  const instruct = message.mode === 'instruct';

  return (
    <div className={mine ? 'pl-6' : 'pr-6'}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          {mine ? 'You' : 'Assistant'}
        </span>
        {/* The badge is on the message, not only on the composer, so a thread
            read a week later still says which turns could have changed the
            artifact and which could not. */}
        <span
          className={`rounded-full px-2 py-0.5 text-label ${
            instruct
              ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'
              : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)]'
          }`}
        >
          {instruct ? 'Instruct' : 'Discuss'}
        </span>
        {message.scope && (
          <span className="truncate text-label text-[var(--on-surface-variant)]">
            {message.scope}
          </span>
        )}
      </div>
      <div
        className={`rounded-xl px-4 py-3 ${
          mine
            ? 'bg-[var(--surface-container-high)]'
            : 'bg-[var(--surface-container-low)]'
        }`}
      >
        <MarkdownOutput content={message.content} />
      </div>
    </div>
  );
}

function ScopePicker({
  scope,
  onScope,
  sections,
  sectionId,
  onSection,
  selection,
  hasContent,
}: {
  scope: ScopeKind;
  onScope: (scope: ScopeKind) => void;
  sections: ReturnType<typeof documentSections>;
  sectionId: string;
  onSection: (id: string) => void;
  selection: string;
  hasContent: boolean;
}) {
  const options: Array<{ key: ScopeKind; label: string; ready: boolean; why: string }> = [
    {
      key: 'selection',
      label: 'Selection',
      ready: selection.length > 0,
      why: 'Select text in the artifact first.',
    },
    {
      key: 'section',
      label: 'Section',
      ready: sections.length > 0,
      why: 'This draft has no headings to split on.',
    },
    {
      key: 'document',
      label: 'Whole document',
      ready: hasContent,
      why: 'There is nothing written yet.',
    },
  ];
  const chosen = options.find((o) => o.key === scope)!;

  return (
    <div className="mb-2">
      <p className="mb-1.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Apply to
      </p>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            onClick={() => onScope(option.key)}
            aria-pressed={option.key === scope}
            // Unavailable scopes stay pressable so the reason can be read.
            // A greyed control with no explanation is a dead end.
            className={`flex-1 rounded-lg px-2 py-1.5 text-label ${
              option.key === scope
                ? 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
            } ${option.ready ? '' : 'opacity-60'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {scope === 'section' && sections.length > 0 && (
        <select
          value={sectionId}
          onChange={(e) => onSection(e.target.value)}
          aria-label="Section to revise"
          className="mt-1.5 w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface)] outline-none"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title}
            </option>
          ))}
        </select>
      )}

      {scope === 'selection' && selection.length > 0 && (
        <p className="mt-1.5 truncate text-label text-[var(--on-surface-variant)]">
          Selected: “{selection.slice(0, 80)}
          {selection.length > 80 ? '…' : ''}”
        </p>
      )}

      {!chosen.ready && (
        <p className="mt-1.5 text-label text-[var(--pm-tertiary)]">{chosen.why}</p>
      )}
    </div>
  );
}

/**
 * FR-09: "The affected scope is shown before application and the prior version
 * remains recoverable."
 *
 * Both halves of that sentence are on this card. The passage that would change
 * is quoted above the replacement, so the user is comparing rather than
 * trusting, and the line about the previous version is stated at the point of
 * decision instead of being a property of the system they have to know about.
 */
export function ProposalCard({
  scopeLabel,
  before,
  after,
  canApply,
  busy,
  onAccept,
  onDiscard,
}: {
  scopeLabel: string;
  before: string;
  after: string;
  canApply: boolean;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      aria-label="Proposed revision"
      className="mt-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3"
    >
      <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Would change
      </p>
      <p className="mt-0.5 text-body text-[var(--on-surface)]">{scopeLabel}</p>

      <div className="mt-3">
        <p className="text-label text-[var(--on-surface-variant)]">Now</p>
        <blockquote className="mt-1 max-h-32 overflow-y-auto rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-label text-[var(--on-surface-variant)]">
          {before}
        </blockquote>
      </div>

      <div className="mt-3">
        <p className="text-label text-[var(--on-surface-variant)]">After</p>
        <div className="mt-1 max-h-64 overflow-y-auto rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
          <MarkdownOutput content={after} />
        </div>
      </div>

      <p className="mt-3 text-label text-[var(--on-surface-variant)]">
        Applying appends a new version. The one you are reading is kept and can be restored.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onAccept}
          disabled={!canApply || busy}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
        >
          Apply as new version
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
        >
          Discard
        </button>
      </div>
    </section>
  );
}

export function AppliedNotice({
  scope,
  canUndo,
  busy,
  onUndo,
  onDismiss,
}: {
  scope: string;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="Revision applied"
      className="mt-4 rounded-xl bg-[var(--success-container)] px-4 py-3"
    >
      <p className="text-body text-[var(--on-success-container)]">
        Applied to {scope.toLowerCase()}.
      </p>
      <p className="mt-0.5 text-label text-[var(--on-success-container)]">
        The previous version is still in this stage&rsquo;s history.
      </p>
      <div className="mt-2 flex items-center gap-2">
        {canUndo && (
          <button
            onClick={onUndo}
            disabled={busy}
            className="rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-40"
          >
            Restore the previous version
          </button>
        )}
        <button
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-success-container)]"
        >
          Keep it
        </button>
      </div>
    </section>
  );
}
