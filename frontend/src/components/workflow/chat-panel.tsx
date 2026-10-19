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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeLines } from '@/lib/workflow/preservation';
import { removeClaimsInstruction, type AddedClaim } from '@/lib/workflow/fact-boundary';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { useStageChat } from './use-stage-chat';
import { ConflictPrompt } from './conflict-prompt';
import {
  findInstructionConflicts,
  holdPendingChange,
  recordConflictChoice,
  settlePendingChange,
  type PendingChange,
} from '@/lib/workflow/conflict-trail';
import { useProjectStore } from '@/stores/project-store';
import {
  precedenceNote,
  type Controls,
  type InstructionConflict,
} from '@/lib/workflow/instruction-conflicts';
import { ReplyActions } from './reply-actions';
import type { RowChange } from '@/lib/workflow/row-actions';
import type { ChatContext, ReplyAction } from '@/types';
import { documentSections, type ScopeKind } from './chat-scope';
import type { StageChatMessage } from '@/lib/supabase/conversation';
import type { NewVersion } from '@/lib/supabase/versions';
import type { ArtifactVersion, Project } from '@/types/project';
import { applyChangesLabel, factChangeGroup, type FactChange } from '@/lib/workflow/fact-reconcile';
import { FactChangeList, toggled } from './fact-change-list';
import { LimitCounter } from '@/components/shared/limit-counter';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

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
  // C7 (Sean, 28 Sep, item 17): the two tabs are two different requests, and
  // their names say which — talk it through, or change the text.
  {
    key: 'discuss',
    label: 'Ask',
    icon: 'forum',
    promise: 'Ask only — this cannot change your document.',
    send: 'Ask',
    placeholder: 'Type your question here…',
  },
  {
    key: 'instruct',
    label: 'Change it',
    icon: 'edit_note',
    promise: 'You see the change before anything is saved.',
    send: 'Draft revision',
    placeholder: 'Type the change you want — e.g. “cut the second paragraph in half”',
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
  /** Why "Change it" is unavailable, when it is for a reason other than reading an old version. */
  cannotChangeBecause?: string;
  /** Where the deliverable is changed, when this stage cannot change it (17 Oct). */
  editElsewhere?: { label: string; onOpen: () => void };
  /**
   * "Buttonize it" (PM-22), compressed (1 Oct, items 13 and 34): a reply is
   * offered as at most four actions, asked for from the model, instead of
   * one Apply per bullet. The workspace owns what an action does.
   */
  suggestActions?: (question: string, reply: string, signal: AbortSignal) => Promise<ReplyAction[]>;
  /** What a table action would change, for the row-by-row review. */
  previewRows?: (action: ReplyAction) => RowChange[];
  onRunAction?: (action: ReplyAction) => Promise<void> | void;
  /** An action that has already done its job (its facts are on record). */
  isActionDone?: (action: ReplyAction) => boolean;
  /** What to do after a done action: the next step, pointed at. */
  afterActionDone?: ReactNode;
  applying?: boolean;
  /**
   * The stage's work is not a prose version — a table, an outline or chapters —
   * so a discussion cannot be saved over it as prose.
   */
  isTable?: boolean;
  /** Where the user is, sent with every question (3 Oct call). */
  getChatContext?: () => ChatContext;
  /** Questions offered before the user types, from the stage's state (3 Oct call). */
  starters?: string[];
  /** A control beside the composer that attaches a file to the project. */
  attach?: ReactNode;
  /** After a revision updated accepted facts, so the project reloads them. */
  onFactsChanged?: () => Promise<unknown> | void;
  /** The requirements checked on a revision's saved text (13 Oct). */
  checkRevision?: (content: string) => { label: string; ok: boolean }[];
  /** Routine revisions are applied without a click (delegated routine decisions). */
  autoApply?: boolean;
  /**
   * A held change to ask about again ("Choose and apply" on the not-applied
   * notice). Taken once: `onResumeTaken` is called when the question is back.
   */
  resumeChange?: PendingChange | null;
  onResumeTaken?: () => void;
  /** The held change whose question is open here now, so the notice does not repeat it. */
  onPendingShown?: (id: string | null) => void;
}

/**
 * C7: whether replies offer "Act on this reply" chips — a per-user
 * preference, kept in this browser only. Storage can be absent or throw
 * (private windows, blocked site data), so both directions are guarded.
 */
const OFFER_ACTIONS_KEY = 'pm.chat.offer-actions';
function readOfferActions(): boolean {
  try {
    return window.localStorage.getItem(OFFER_ACTIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}
function writeOfferActions(on: boolean) {
  try {
    window.localStorage.setItem(OFFER_ACTIONS_KEY, on ? 'on' : 'off');
  } catch {
    // A preference that cannot be kept is still honoured for this page.
  }
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
  cannotChangeBecause,
  editElsewhere,
  suggestActions,
  previewRows,
  onRunAction,
  isActionDone,
  afterActionDone,
  applying = false,
  isTable = false,
  getChatContext,
  starters = [],
  attach,
  onFactsChanged,
  checkRevision,
  autoApply,
  resumeChange = null,
  onResumeTaken,
  onPendingShown,
}: Props) {
  const [offerActions, setOfferActions] = useState(true);
  useEffect(() => setOfferActions(readOfferActions()), []);
  const chat = useStageChat({
    project,
    stageId,
    stageLabel,
    content,
    headVersion,
    appendStageVersion,
    restoreStageVersion,
    getChatContext,
    onFactsChanged,
    checkRevision,
    autoApply,
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

  // PM-24: an instruction is checked for conflicts before it is sent.
  const [checking, setChecking] = useState(false);
  const [conflicting, setConflicting] = useState<{
    text: string;
    conflicts: InstructionConflict[];
    action?: ReplyAction;
    /** The held row (see `holdPendingChange`), once it is written. */
    pendingId?: string;
  } | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const upsertRecommendation = useProjectStore((s) => s.upsertRecommendation);

  /**
   * Ask "which takes priority?" and hold the change while it is asked: an
   * unanswered question is a change not applied yet, and says so wherever the
   * user goes next (16 Oct, Sean, NORTHSTAR-2).
   */
  /** Answers given before the held row was written: settled as soon as it is. */
  const answeredEarly = useRef(new Map<string, 'applied' | 'withdrawn'>());
  const settle = useCallback(
    (id: string | undefined, text: string, outcome: 'applied' | 'withdrawn') => {
      if (!id) {
        answeredEarly.current.set(text, outcome);
        return;
      }
      void settlePendingChange(id, outcome).then(upsertRecommendation, () => undefined);
    },
    [upsertRecommendation]
  );
  const askPriority = useCallback(
    (text: string, conflicts: InstructionConflict[], action?: ReplyAction) => {
      answeredEarly.current.delete(text);
      setConflicting({ text, conflicts, action });
      holdPendingChange({ projectId: project.id, userId: project.user_id, stageId, stageLabel, instruction: text, conflicts }).then(
        (row) => {
          upsertRecommendation(row);
          const early = answeredEarly.current.get(text);
          if (early) {
            answeredEarly.current.delete(text);
            settle(row.id, text, early);
            return;
          }
          setConflicting((c) => (c && c.text === text && !c.pendingId ? { ...c, pendingId: row.id } : c));
        },
        () => undefined
      );
    },
    [project.id, project.user_id, stageId, stageLabel, upsertRecommendation, settle]
  );

  // "Choose and apply": the held question, back as it was asked.
  useEffect(() => {
    if (!resumeChange || conflicting || readOnly) return;
    if (resumeChange.stageId !== stageId) return;
    if (resumeChange.conflicts.length) {
      setConflicting({ text: resumeChange.instruction, conflicts: resumeChange.conflicts, pendingId: resumeChange.id });
    } else {
      setDraft(resumeChange.instruction);
      settle(resumeChange.id, resumeChange.instruction, 'withdrawn');
    }
    onResumeTaken?.();
  }, [resumeChange, conflicting, readOnly, stageId, onResumeTaken, settle]);

  useEffect(() => {
    onPendingShown?.(conflicting?.pendingId ?? null);
  }, [conflicting?.pendingId, onPendingShown]);
  useEffect(() => () => onPendingShown?.(null), [onPendingShown]);

  // The question is only useful if it can be answered: bring its top into the
  // thread's view when it appears. Its buttons stay pinned (see ConflictPrompt),
  // so on a short window the answers are reachable without hunting for them.
  useEffect(() => {
    const thread = threadRef.current;
    const prompt = conflictRef.current;
    if (!conflicting || !thread || !prompt) return;
    thread.scrollTop += prompt.getBoundingClientRect().top - thread.getBoundingClientRect().top - 8;
  }, [conflicting]);
  // The latest assistant reply in Discuss, split into points that can each be applied.
  const latestReply = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.mode === 'discuss');
  const latestReplyId = latestReply?.id ?? null;

  // Actions are asked for once per reply, and only for replies given while
  // the panel is open: a thread reopened tomorrow must not spend a call on
  // an answer the user has already read. That one gets a button instead.
  const [actions, setActions] = useState<{ forId: string; list: ReplyAction[] | null; loading: boolean; error: string | null } | null>(null);
  const seenOnLoad = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!chat.loading && seenOnLoad.current === undefined) seenOnLoad.current = latestReplyId;
  }, [chat.loading, latestReplyId]);
  const actionsAbort = useRef<AbortController | null>(null);
  const requestActions = useCallback(
    (replyId: string) => {
      const reply = chat.messages.find((m) => m.id === replyId);
      if (!reply || !suggestActions) return;
      const index = chat.messages.indexOf(reply);
      const question = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === 'user')?.content ?? '';
      actionsAbort.current?.abort();
      const controller = new AbortController();
      actionsAbort.current = controller;
      setActions({ forId: replyId, list: null, loading: true, error: null });
      suggestActions(question, reply.content, controller.signal).then(
        (list) => !controller.signal.aborted && setActions({ forId: replyId, list, loading: false, error: null }),
        () =>
          !controller.signal.aborted &&
          // Not being able to suggest actions is not a failed answer.
          setActions({ forId: replyId, list: [], loading: false, error: 'Could not work out actions for this reply.' })
      );
    },
    [chat.messages, suggestActions]
  );
  useEffect(() => {
    if (!suggestActions || !offerActions || readOnly || chat.loading) return;
    if (!latestReplyId || seenOnLoad.current === undefined || latestReplyId === seenOnLoad.current) return;
    if (actions?.forId === latestReplyId) return;
    requestActions(latestReplyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestReplyId, offerActions, readOnly, chat.loading]);
  useEffect(() => () => actionsAbort.current?.abort(), []);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // A revision from a button is an instruction like any other: checked
  // against the objective and earlier decisions before it reaches the model
  // (1 Oct, item 33). Row changes are shown row by row and are not checked.
  const runAction = useCallback(
    async (action: ReplyAction) => {
      if (!onRunAction) return;
      if (action.kind === 'revise' && action.instruction) {
        setChecking(true);
        const conflicts = await findInstructionConflicts({
          project, stageId, instruction: action.instruction, headVersionId: headVersion?.id ?? null,
          stage: { label: stageLabel, instruction: getChatContext?.().stage_instruction },
        });
        setChecking(false);
        if (conflicts.length) {
          askPriority(action.instruction, conflicts, action);
          return;
        }
      }
      await onRunAction(action);
    },
    [onRunAction, project, stageId, stageLabel, getChatContext, headVersion?.id, askPriority]
  );

  const canSend =
    !readOnly && !chat.busy && !checking && !conflicting && draft.trim().length > 0 && (mode === 'discuss' || scopeReady);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    // Cleared up front: a message the user has to delete by hand before typing
    // the next one reads as a failure even when it succeeded.
    setDraft('');
    if (mode === 'discuss') {
      await chat.discuss(text);
      return;
    }
    setChecking(true);
    // Only instructions not yet applied are pending: an applied one is the
    // current version, and was counted twice (14 Oct, Sean, LANTERN).
    const recent = chat.messages.filter((m) => m.role === 'user' && m.mode === 'instruct' && m.appliedVersionId == null && !m.discarded).map((m) => m.content);
    // Checked as it will be sent: a revision pasted back from an older export
    // is only its edits, so a value the user did not touch is not asked about.
    const resolved = await chat.instructionFor(text, scope);
    if ('error' in resolved) {
      setChecking(false);
      await chat.propose(text, scope, { selection, sectionId: effectiveSectionId });
      return;
    }
    const conflicts = await findInstructionConflicts({
      project, stageId, instruction: resolved.ask, recentInstructions: recent, headVersionId: headVersion?.id ?? null,
      stage: { label: stageLabel, instruction: getChatContext?.().stage_instruction },
    });
    setChecking(false);
    if (conflicts.length) {
      askPriority(text, conflicts);
      return;
    }
    await chat.propose(text, scope, { selection, sectionId: effectiveSectionId });
  }, [draft, mode, scope, selection, effectiveSectionId, chat, project, stageId, stageLabel, getChatContext, headVersion?.id, askPriority]);

  const resolveConflicts = useCallback(
    async (choices: Controls[]) => {
      if (!conflicting) return;
      const { text, conflicts, action, pendingId } = conflicting;
      setConflicting(null);
      settle(pendingId, text, 'applied');
      await Promise.all(
        conflicts.map((conflict, i) =>
          recordConflictChoice({ projectId: project.id, userId: project.user_id, stageId, instruction: text, conflict, controls: choices[i] })
            .catch(() => undefined)
        )
      );
      const precedence = conflicts.map((c, i) => precedenceNote(c, text, choices[i]));
      if (action) {
        // An action button's revision carries the user's answer with it.
        await onRunAction?.({ ...action, instruction: [text, ...precedence].join('\n') });
        return;
      }
      await chat.propose(text, scope, { selection, sectionId: effectiveSectionId, precedence });
    },
    [conflicting, project, stageId, chat, scope, selection, effectiveSectionId, onRunAction, settle]
  );

  return (
    <section
      ref={panelRef}
      aria-label="Side chat"
      className="flex h-full min-h-0 flex-col rounded-xl bg-[var(--surface-container-lowest)]"
    >
      <header className="px-5 pt-5">
        <h2 className="text-title text-[var(--on-surface)]">Side chat</h2>
        <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{stageLabel}</p>
        {suggestActions && (
          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-label text-[var(--on-surface-variant)]">
            <input
              type="checkbox"
              checked={offerActions}
              onChange={(e) => {
                setOfferActions(e.target.checked);
                writeOfferActions(e.target.checked);
              }}
              className="h-3.5 w-3.5 accent-[var(--pm-primary)]"
            />
            Offer actions from replies
          </label>
        )}
      </header>

      <ModeSwitch
        mode={mode}
        onChange={setMode}
        disabled={readOnly}
        instructDisabledReason={
          canInstruct
            ? null
            : (cannotChangeBecause ?? 'Ask only — open the latest version to change it.')
        }
      />
      {editElsewhere && (
        <p className="flex flex-wrap items-center gap-2 px-5 pt-2 text-label text-[var(--on-surface-variant)]">
          To change the {editElsewhere.label}, open it and press Edit this stage.
          <button
            type="button"
            onClick={editElsewhere.onOpen}
            className="rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1 font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-highest)]"
          >
            Open {editElsewhere.label}
          </button>
        </p>
      )}

      <div
        ref={threadRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sidebar-scroll"
        aria-live="polite"
      >
        {chat.loading ? (
          <p className="text-label text-[var(--on-surface-variant)]">Loading the thread…</p>
        ) : chat.messages.length === 0 ? (
          <>
            <EmptyThread mode={mode} hasContent={content.trim().length > 0} />
            {/* In the thread, not above the box: stacked over the input they
                pushed it below the fold (17 Oct, Sean: "you have to kind of
                scroll down to find it"). */}
            {mode === 'discuss' && !readOnly && !chat.busy && !conflicting && starters.length > 0 && (
              <div role="group" aria-label="Suggested questions" className="mt-4 flex flex-col gap-1.5">
                {starters.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void chat.discuss(q)}
                    className="rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-left text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <ol className="space-y-4">
            {chat.messages.map((message) => (
              <li key={message.id}>
                <Bubble message={message} />
                {suggestActions && onRunAction && offerActions && !readOnly && message.id === latestReplyId && dismissedFor !== message.id && (
                  <div className="mt-2">
                    <ReplyActions
                      actions={actions?.forId === message.id ? actions.list : null}
                      loading={actions?.forId === message.id && actions.loading}
                      error={actions?.forId === message.id ? actions.error : null}
                      busy={applying}
                      previewRows={previewRows}
                      onRun={runAction}
                      onDismiss={() => setDismissedFor(message.id)}
                      onRequest={() => requestActions(message.id)}
                      isDone={isActionDone}
                      afterDone={afterActionDone}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {chat.busy && (
          <p className="mt-4 text-label text-[var(--on-surface-variant)]">
            {mode === 'discuss' ? 'Thinking…' : 'Drafting the revision…'}
          </p>
        )}

        {checking && (
          <p role="status" className="mt-3 text-label text-[var(--on-surface-variant)]">Checking it against your objective and earlier decisions…</p>
        )}
        {conflicting && (
          <div ref={conflictRef} className="mt-3">
            <ConflictPrompt
              instruction={conflicting.text}
              conflicts={conflicting.conflicts}
              busy={chat.busy}
              onContinue={(choices) => void resolveConflicts(choices)}
              onCancel={() => {
                if (!conflicting.action) setDraft(conflicting.text);
                settle(conflicting.pendingId, conflicting.text, 'withdrawn');
                setConflicting(null);
              }}
            />
          </div>
        )}
        {chat.proposal && (
          <ProposalCard
            key={chat.proposal.messageId ?? chat.proposal.after}
            scopeLabel={chat.proposal.target.label}
            before={chat.proposal.before}
            after={chat.proposal.after}
            canApply={chat.canApply}
            busy={chat.busy}
            factChanges={chat.proposal.factChanges}
            summary={chat.proposal.changeSummary}
            putBack={chat.proposal.putBack}
            putBackKept={chat.proposal.nextContent !== chat.proposal.withoutPutBack}
            onTogglePutBack={chat.togglePutBack}
            removedUnasked={chat.proposal.removedUnasked}
            addedClaims={chat.proposal.addedClaims}
            revisedFrom={chat.proposal.revisedFrom}
            onRemoveClaims={() => {
              const p = chat.proposal;
              if (!p?.addedClaims?.length) return;
              const again = `${p.instruction}\n\n${removeClaimsInstruction(p.addedClaims)}`;
              if (p.target.kind === 'document') void chat.propose(again, 'document');
              else {
                setDraft(again);
                setMode('instruct');
                chat.discard();
              }
            }}
            onAccept={(factIds) => void chat.accept(factIds)}
            onAdjust={() => {
              setDraft(chat.adjust());
              setMode('instruct');
            }}
            onDiscard={chat.discard}
          />
        )}

        {chat.applied && (
          <AppliedNotice
            scope={chat.applied.scope}
            summary={chat.applied.summary}
            checks={chat.applied.checks}
            auto={chat.applied.auto}
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
      {chat.redo && !readOnly && (
        <div className="px-5 pb-2">
          <button
            type="button"
            onClick={() => void chat.redraft()}
            disabled={chat.busy}
            className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label font-semibold text-[var(--on-primary)] disabled:opacity-40"
          >
            Apply my change to the new version{headVersion ? ` (v${headVersion.version_number})` : ''}
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="px-5 pb-5">
          {/* PM-10: the original core's "Save as New Version" — the discussion
              becomes a revised draft, shown for review before it is saved. */}
          {mode === 'discuss' && chat.canApply && !chat.proposal && !isTable &&
            chat.messages.some((m) => m.role === 'assistant') && (
            <button
              onClick={() => void chat.saveDiscussion()}
              disabled={chat.busy || content.trim().length === 0}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-label text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">note_add</span>
              Save this discussion as a new version
            </button>
          )}
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
              onChange={(e) => setDraft(e.target.value.slice(0, INPUT_LIMITS.message))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (canSend) void send();
                }
              }}
              rows={3}
              aria-label={mode === 'discuss' ? 'Ask a question' : 'Give a revision instruction'}
              placeholder={spec.placeholder}
              className="w-full resize-y rounded-lg bg-[var(--surface-container-lowest)] px-2 py-1.5 text-body text-[var(--on-surface)] outline-none ring-1 ring-[var(--outline-variant)] placeholder:text-[var(--on-surface-variant)] focus:ring-2 focus:ring-[var(--pm-primary)]/50"
             
            />
            <LimitCounter length={draft.length} limit={INPUT_LIMITS.message} />
            <div className="mt-1 flex items-center gap-2">
              {attach}
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
              title={m.key === 'instruct' && instructDisabledReason ? instructDisabledReason : undefined}
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

      {/* Stated, not implied, and once (17 Oct, Sean: the lock line and a red
          note under it read as more instructions than the task). Where the
          change tab is unavailable, the reason is the line. */}
      <p className="mt-2 flex items-start gap-1.5 text-label text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">
          {mode === 'discuss' ? 'lock' : 'rate_review'}
        </span>
        <span>{mode === 'discuss' && instructDisabledReason ? instructDisabledReason : MODES.find((m) => m.key === mode)!.promise}</span>
      </p>
    </div>
  );
}

function EmptyThread({ mode, hasContent }: { mode: Mode; hasContent: boolean }) {
  return (
    <p className="text-body text-[var(--on-surface-variant)]">
      {mode === 'discuss'
        ? hasContent
          ? 'Ask anything about this draft — what it assumes, what it leaves out, whether it suits the audience. Nothing here edits it.'
          // No draft yet (Sean, 10 Oct, email 6.11: "this draft" before one existed).
          : 'Ask anything about this stage — what it is for, what it needs from you, what to put in it. There is no draft here yet.'
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
          {instruct ? 'Change it' : 'Ask'}
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
      why: 'Select text in the draft first.',
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
  factChanges = [],
  summary,
  putBack = [],
  putBackKept = true,
  onTogglePutBack,
  removedUnasked = [],
  addedClaims = [],
  onRemoveClaims,
  revisedFrom,
  onAccept,
  onAdjust,
  onDiscard,
}: {
  scopeLabel: string;
  /** Pasted back from outside, revised from an older version: only its edits were applied (17 Oct). */
  revisedFrom?: { version: number; head: number; edits: number };
  /** Lines the revision dropped without being asked, put back (14 Oct). */
  putBack?: string[];
  /** Whether they are still put back, or the user chose to let them go. */
  putBackKept?: boolean;
  onTogglePutBack?: () => void;
  /** Longer passages that went without being asked, reported. */
  removedUnasked?: string[];
  /** Personal details the revision added that nobody supplied (14 Oct). */
  addedClaims?: AddedClaim[];
  onRemoveClaims?: () => void;
  /** What the revision changes, in one line (13 Oct). */
  summary?: string;
  /** Back to the instruction, to change what was asked (13 Oct, Sean: "Apply and Adjust buttons"). */
  onAdjust?: () => void;
  before: string;
  after: string;
  canApply: boolean;
  busy: boolean;
  /** Accepted facts the revision changes; each ticked one is updated with it. */
  factChanges?: FactChange[];
  onAccept: (updateFactIds: string[]) => void;
  onDiscard: () => void;
}) {
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const updating = factChanges.filter((c) => !kept.has(c.fact.id)).map((c) => c.fact.id);
  return (
    <section
      aria-label="Proposed revision"
      className="mt-4 rounded-xl bg-[var(--surface-container-high)] px-4 py-3"
    >
      <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Proposed — not saved yet
      </p>
      <p className="mt-0.5 text-body text-[var(--on-surface)]">{scopeLabel}</p>
      {revisedFrom && (
        <p aria-label="Revised from an older version" className="mt-1 text-label text-[var(--on-surface)]">
          Your revision started from version {revisedFrom.version}; this stage is now at version {revisedFrom.head}. Only your{' '}
          {revisedFrom.edits === 1 ? 'edit was' : `${revisedFrom.edits} edits were`} applied, so the changes made here since are kept.
        </p>
      )}
      {summary && (
        <p aria-label="What changed" className="mt-1 text-label text-[var(--on-surface)]">
          <span className="text-[var(--on-surface-variant)]">What changed: </span>
          {summary}
        </p>
      )}

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

      {factChanges.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2" aria-label="Facts this changes">
          <p className="text-label text-[var(--on-surface)]">
            {factChangesHeading(factChanges)}
          </p>
          <FactChangeList changes={factChanges} kept={kept} onToggle={(id, on) => setKept((prev) => toggled(prev, id, on))} />
        </div>
      )}

      {(putBack.length > 0 || removedUnasked.length > 0) && (
        <div className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2" aria-label="Kept from before">
          {putBack.length > 0 && (
            <p className="text-label text-[var(--on-surface)]">
              {putBackKept
                ? `Kept ${describeLines(putBack)}: the revision dropped ${putBack.length === 1 ? 'it' : 'them'}, and your instruction did not ask for that.`
                : `${describeLines(putBack)} will be removed, as the revision proposed.`}
              {onTogglePutBack && (
                <button onClick={onTogglePutBack} disabled={busy} className="ml-2 text-[var(--pm-primary)] underline-offset-2 hover:underline">
                  {putBackKept ? 'Remove them anyway' : 'Keep them'}
                </button>
              )}
            </p>
          )}
          {removedUnasked.length > 0 && (
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">
              Also no longer there: {describeLines(removedUnasked, 2)}. If that was not intended, choose Adjust.
            </p>
          )}
        </div>
      )}

      {addedClaims.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2" aria-label="Details you did not supply">
          <p className="text-label text-[var(--on-surface)]">
            This adds details you did not supply. You asked not to invent any:
          </p>
          <ul className="mt-1 list-disc pl-5 text-label text-[var(--on-surface-variant)]">
            {addedClaims.map((c) => (
              <li key={c.quote}>
                “{c.quote}”{c.why ? ` — ${c.why}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
            If a detail would help, tell me the real one in the chat.
          </p>
          {onRemoveClaims && (
            <button
              onClick={onRemoveClaims}
              disabled={busy}
              className="mt-2 rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-40"
            >
              Take these out
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-label text-[var(--on-surface-variant)]">
        Applying appends a new version. The one you are reading is kept and can be restored.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => onAccept(updating)}
          disabled={!canApply || busy}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
        >
          {updating.length
            ? applyChangesLabel(updating.length)
            : 'Apply as new version'}
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
        >
          Discard
        </button>
        {onAdjust && (
          <button
            onClick={onAdjust}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)] hover:text-[var(--on-surface)]"
          >
            Adjust
          </button>
        )}
      </div>
    </section>
  );
}

export function AppliedNotice({
  scope,
  summary,
  checks = [],
  auto = false,
  canUndo,
  busy,
  onUndo,
  onDismiss,
}: {
  scope: string;
  summary?: string;
  checks?: { label: string; ok: boolean }[];
  auto?: boolean;
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
        Applied to {scope.toLowerCase()}{auto ? ' under your routine-decision authority' : ''}.
      </p>
      {summary && <p className="mt-0.5 text-label text-[var(--on-success-container)]">What changed: {summary}</p>}
      {checks.length > 0 && (
        <ul aria-label="Checked on the saved text" className="mt-1 space-y-0.5 text-label text-[var(--on-success-container)]">
          {checks.map((c) => (
            <li key={c.label}>
              <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[14px]">{c.ok ? 'check' : 'close'}</span>
              {c.label}
            </li>
          ))}
        </ul>
      )}
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

/** "This changes an accepted fact", "This states 2 new facts", "notes a request", or a mix. */
function factChangesHeading(changes: readonly FactChange[]): string {
  const count = (g: ReturnType<typeof factChangeGroup>) => changes.filter((c) => factChangeGroup(c) === g).length;
  const changed = count('changed');
  const added = count('new');
  const requests = count('request');
  const parts = [
    changed ? `changes ${changed === 1 ? 'an accepted fact' : `${changed} accepted facts`}` : '',
    added ? `states ${added === 1 ? 'a new fact' : `${added} new facts`}` : '',
    requests ? `notes ${requests === 1 ? 'a request' : `${requests} requests`} nobody has approved` : '',
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `This ${list}. Record ${changes.length === 1 ? 'it' : 'them'} so every later stage and check uses ${changes.length === 1 ? 'it' : 'them'}?`;
}
