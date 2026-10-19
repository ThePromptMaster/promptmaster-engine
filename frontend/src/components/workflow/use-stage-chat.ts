'use client';

import { RefusedRevision } from '@/lib/workflow/commit-check';

/**
 * The side chat's machinery: two modes, and the boundary between them.
 *
 * FR-08 and section 8 of the UX requirements ask for a chat that supports
 * "discussion that does not modify the artifact" *and* "modification
 * instructions that can be applied to a selected scope". Those are two very
 * different powers wearing the same input box, and the whole risk of the
 * feature is a user who cannot tell which one they are about to use.
 *
 * So the boundary is structural, not conventional:
 *
 * - **`discuss()` reaches exactly one endpoint — `chat-message`.** That
 *   endpoint creates no iteration and evaluates nothing; it returns a reply
 *   and nothing else. `discuss` does not call `appendStageVersion`, does not
 *   construct a `ScopeTarget`, and has no code path that could. A test asserts
 *   this, because it is the property that would break quietly.
 * - **`propose()` never writes either.** It resolves a scope, revises that
 *   scope's text, and returns a proposal for the user to look at. FR-09
 *   requires the affected scope to be shown before application, which means
 *   proposing and applying have to be two steps.
 * - **`accept()` is the only function here that appends a version**, and it
 *   appends — never mutates — so the prior version stays recoverable. `undo()`
 *   restores it, which is FR-08's third verb.
 *
 * The chat also has to survive a refresh: a thread the user cannot get back is
 * worse than no thread, and FR-01 lists the durable state a project keeps.
 * Persistence is to `conversation_messages`, keyed by project and stage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api/client';
import {
  loadStageChat,
  markStageChatApplied,
  markStageChatDiscarded,
  saveStageChatMessage,
  type StageChatMessage,
} from '@/lib/supabase/conversation';
import { inputsFrom } from './use-stage-generation';
import { asIteration } from '@/lib/workflow/legacy';
import {
  describeScope,
  resolveScope,
  scopeNoun,
  spliceScope,
  type ScopeKind,
  type ScopeTarget,
} from './chat-scope';
import { listVersions, type NewVersion } from '@/lib/supabase/versions';
import { resolveInstruction, withoutStamps, type ResolvedInstruction } from '@/lib/workflow/version-stamp';
import type { ArtifactVersion, Project } from '@/types/project';
import { factChangesFromRevision, isNewFact, newFactSource, withMeaningChanges, type FactChange } from '@/lib/workflow/fact-reconcile';
import { recordFacts, supersedeFact } from '@/lib/supabase/facts';
import type { ChatContext, ChatMessage } from '@/types';
import { describeLines, keepUnasked } from '@/lib/workflow/preservation';
import { addedClaims, noInventedDetails, suppliedText, type AddedClaim } from '@/lib/workflow/fact-boundary';

/** An instruction as it was sent, ready to be drafted again. */
export interface RedraftRequest {
  instruction: string;
  kind: ScopeKind;
  options: { selection?: string; sectionId?: string; precedence?: string[] };
}

/**
 * A refusal because the stage moved on under the proposal — Go saved a
 * version while it was being drafted (16 Oct, Sean, NORTHSTAR-2). The change
 * itself is still wanted; only the text it was drafted on is gone.
 */
export const isStaleBaseRefusal = (message: string): boolean => /^The stage changed while this revision was being made/.test(message);

/** A revision the user has been shown but has not yet accepted. */
export interface ChatProposal {
  /** The user's instruction, as they typed it. */
  instruction: string;
  /** Exactly the characters that would change. */
  target: ScopeTarget;
  /** A quoted preview of those characters — FR-09's "shown before". */
  before: string;
  /** What they would be replaced with. */
  after: string;
  /** The whole document as it would stand, ready to append. */
  nextContent: string;
  /** The document the proposal was made on; accepting it after the stage moved on is refused. */
  baseContent?: string;
  /** How it was asked for, so it can be drafted again on a newer version in one click. */
  ask?: RedraftRequest;
  /** The message row the instruction was persisted as, to stamp on accept. */
  messageId: string | null;
  changeSummary: string;
  /** How the version is recorded when accepted; defaults to 'chat_instruct'. */
  source?: string;
  /**
   * Accepted facts whose values the revision replaces (10 Oct, Sean: the draft
   * said Wednesday while the facts still said Thursday, and Go changed it back).
   * Offered with the revision; the ones the user keeps ticked are updated on accept.
   */
  factChanges?: FactChange[];
  /**
   * Lines the revision dropped without being asked, put back in `nextContent`
   * (14 Oct, Sean: a time change dropped "Confirm 12 attendees").
   */
  putBack?: string[];
  /** `nextContent` as the model returned it, for "Remove them anyway". */
  withoutPutBack?: string;
  /** Longer passages that went without being asked, reported only. */
  removedUnasked?: string[];
  /** Personal details it added that nobody supplied, when the project says not to invent them. */
  addedClaims?: AddedClaim[];
  /**
   * A revision pasted back from outside PromptMaster that started from an
   * older version: only its edits were applied, keeping what changed since.
   */
  revisedFrom?: { version: number; head: number; edits: number };
}

/** What was applied last, so it can be undone without hunting for it. */
export interface AppliedRevision {
  scope: string;
  /** The version to restore to. Held from *before* the append. */
  previousVersionId: string | null;
  /** What changed, in one line (13 Oct, Sean: "a short explanation"). */
  summary?: string;
  /** What was checked on the saved text, each as one line (13 Oct). */
  checks?: { label: string; ok: boolean }[];
  /** Applied under "Routine decisions: handle them for me", without a click. */
  auto?: boolean;
}

interface Options {
  project: Project;
  stageId: string;
  stageLabel: string;
  /** The content of the version being viewed — what a scope resolves against. */
  content: string;
  /** The head version. Instructions apply to the head, never to an old one. */
  headVersion: ArtifactVersion | null;
  /** Absent on a surface with no store behind it; then nothing can be applied. */
  appendStageVersion?: (
    stageId: string,
    name: string,
    version: NewVersion
  ) => Promise<unknown>;
  restoreStageVersion?: (stageId: string, versionId: string) => Promise<void>;
  /** Where the user is: stage, workflow, outline, chapters, buttons (3 Oct call). */
  getChatContext?: () => ChatContext;
  /** After facts were updated with a revision, so the project reloads them. */
  onFactsChanged?: () => Promise<unknown> | void;
  /** The requirements checked on a revision's saved text, each met or not (13 Oct). */
  checkRevision?: (content: string) => { label: string; ok: boolean }[];
  /**
   * Routine revisions are the user's delegated decision (13 Oct, Sean: "If
   * I've authorized routine revisions, it should apply them within that
   * authority and report what changed"). A proposal that changes no fact is
   * then applied at once; one that does still waits for the click.
   */
  autoApply?: boolean;
}

/**
 * The stage's content as the `Iteration` the conversation endpoints expect.
 *
 * Those endpoints predate stages and are shaped around the retired
 * five-phase flow, but the only field either prompt reads from an iteration is
 * `output` (and `iteration_number`, to label it). Assembling one here is what
 * lets the side chat reuse three endpoints, three prompt builders and their
 * tests without a backend change.
 */

/** The thread as the backend wants it: role and content, nothing else. */
/** The thread without instructions that never changed the document. */
export function inForce(messages: readonly StageChatMessage[]): StageChatMessage[] {
  return messages.filter((m) => !(m.role === 'user' && m.mode === 'instruct' && !m.appliedVersionId));
}

function asHistory(messages: StageChatMessage[]): ChatMessage[] {
  return messages.map(({ id, iteration_number, role, content, created_at }) => ({
    id,
    iteration_number,
    role,
    content,
    created_at,
  }));
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function useStageChat({
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
  autoApply = false,
}: Options) {
  const [messages, setMessages] = useState<StageChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ChatProposal | null>(null);
  /** A change refused only because the stage moved on: "Apply my change to the new version". */
  const [redo, setRedo] = useState<RedraftRequest | null>(null);
  const [applied, setApplied] = useState<AppliedRevision | null>(null);

  // A reply that lands after the user has moved to another stage belongs to a
  // thread that is no longer on screen; dropping it is better than writing it
  // into the wrong one.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // The thread on screen. A reply that comes back after the user moved to
  // another project or stage is saved to its own thread and not shown here.
  const thread = useRef(`${project.id}:${stageId}`);
  thread.current = `${project.id}:${stageId}`;

  useEffect(() => {
    let current = true;
    // Another project's or stage's thread is never shown, nor sent as history,
    // while this one loads (Sean, 10 Oct, email 6.9: the churn project's chat
    // answered about tariffs — the thread of another project's stage with the
    // same id, still on screen when the page moved between projects).
    setMessages([]);
    setLoading(true);
    setProposal(null);
    setApplied(null);
    setError(null);
    loadStageChat(project.id, stageId)
      .then((rows) => {
        if (!current) return;
        setMessages(rows);
      })
      .catch(() => {
        if (current) setMessages([]);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [project.id, stageId]);

  const versionNumber = headVersion?.version_number ?? 1;

  const persist = useCallback(
    async (
      role: 'user' | 'assistant',
      text: string,
      mode: 'discuss' | 'instruct',
      scope?: string
    ): Promise<StageChatMessage> => {
      const own = `${project.id}:${stageId}`;
      const saved = await saveStageChatMessage({
        project_id: project.id,
        stage_id: stageId,
        version_id: headVersion?.id ?? null,
        iteration_number: versionNumber,
        role,
        content: text,
        mode,
        scope: scope ?? null,
      });
      if (live.current && thread.current === own) setMessages((prior) => [...prior, saved]);
      return saved;
    },
    [project.id, stageId, headVersion?.id, versionNumber]
  );

  /**
   * Ask a question. Reaches `chat-message` and nothing else.
   *
   * There is no branch in here that can append a version, and that is the
   * point: "this will not change your document" has to be true by
   * construction, not by the caller remembering to pass the right flag.
   */
  const discuss = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy || loading) return;
      setBusy(true);
      setError(null);

      try {
        const priorHistory = asHistory(messages);
        await persist('user', message, 'discuss');

        const response = await api.chatMessage({
          inputs: inputsFrom(project),
          active_iteration: asIteration(content, versionNumber, project.mode),
          chat_history: priorHistory,
          user_message: message,
          model: project.model,
          context: getChatContext?.(),
        });

        await persist('assistant', response.assistant_message.content, 'discuss');
      } catch (err) {
        if (live.current) {
          setError(errorText(err, 'Could not reach the model. Try again in a moment.'));
        }
      } finally {
        if (live.current) setBusy(false);
      }
    },
    [busy, loading, messages, persist, project, content, versionNumber, getChatContext]
  );

  /**
   * A revision checked against the text it was made from (14 Oct): what it
   * dropped without being asked is put back, and — when the project says not
   * to invent details — the personal details it added are found.
   */
  const checkedRevision = useCallback(
    async (before: string, revised: string, instruction: string, said: readonly string[]) => {
      const kept = keepUnasked(before, revised, instruction);
      const claims = noInventedDetails(project, said)
        ? await addedClaims({ before, after: kept.text, supplied: suppliedText(project, said), instruction, model: project.model })
        : [];
      return {
        nextContent: kept.text,
        putBack: kept.restored,
        fields: {
          ...(kept.restored.length ? { putBack: kept.restored, withoutPutBack: revised } : {}),
          ...(kept.reported.length ? { removedUnasked: kept.reported } : {}),
          ...(claims.length ? { addedClaims: claims } : {}),
        },
      };
    },
    [project]
  );

  /**
   * Draft a revision of one scope and return it for review. Writes nothing.
   *
   * The scope's text is handed to `apply-to-answer` as the version under
   * discussion, so what comes back is a revision *of that passage* rather than
   * of the whole artifact — which is what makes selection and section scopes
   * mean anything.
   */
  /**
   * What a typed instruction asks for, as it will be sent (17 Oct, Sean: work
   * alongside other assistants). Text pasted back from an export whose stamp
   * names an older version of this stage was revised from that version: sent
   * whole, it would undo what changed here since, so only the user's own edits
   * against it go. The conflict check reads this too, so it never asks about a
   * value the user did not touch. Stamps never reach the model or the document.
   */
  const instructionFor = useCallback(
    (typed: string, kind: ScopeKind): Promise<ResolvedInstruction> =>
      resolveInstruction(typed, {
        wholeDocument: kind === 'document',
        stageId,
        head: headVersion,
        loadVersion: async (n) => (headVersion ? (await listVersions(headVersion.artifact_id)).find((v) => v.version_number === n) : undefined),
      }),
    [headVersion, stageId]
  );

  const propose = useCallback(
    async (
      instruction: string,
      kind: ScopeKind,
      options: { selection?: string; sectionId?: string; precedence?: string[] } = {}
    ) => {
      const typed = instruction.trim();
      if (!typed || busy || loading) return;
      // An export's version stamps never reach the document or the model as words.
      const text = withoutStamps(typed) || typed;

      const target = resolveScope(content, kind, options);
      if (!target) {
        // Never widen to the whole document. A selection that cannot be found
        // in the source, or a section that has moved, is a refusal.
        setError(
          kind === 'selection'
            ? 'That selection is not in this version of the text. Select inside the draft and try again.'
            : `There is no ${kind} to revise here yet.`
        );
        return;
      }

      setBusy(true);
      setError(null);

      try {
        // An instruction that was never applied — discarded, set aside, or
        // replaced by this one — is not part of the document. Sent as history,
        // the model applied it anyway (18 Oct, production pass: a discarded
        // "$17,000" correction came back with an unrelated edit).
        const priorHistory = asHistory(inForce(messages));
        setRedo(null);

        // Revised elsewhere from an older version: only the user's own edits go.
        const resolved = await instructionFor(typed, kind);
        if ('error' in resolved) {
          if (live.current) setError(resolved.error);
          return;
        }
        const { ask, revisedFrom } = resolved;

        const saved = await persist('user', text, 'instruct', target.label);

        // The persisted message is the user's own words; the message *sent*
        // adds the scope contract, because `apply-to-answer` was written for
        // whole answers and would otherwise be entitled to return one.
        const scoped: ChatMessage = {
          id: `${saved.id}-scoped`,
          iteration_number: versionNumber,
          role: 'user',
          content:
            `Revise ONLY the passage given as the current version. It is ` +
            `${scopeNoun(kind)} of a longer document, not the whole of it. Return the ` +
            `revised passage alone — no preamble, no surrounding text, no commentary.\n\n` +
            `Instruction: ${ask}` +
            // PM-24: what the user decided when this instruction conflicted with something.
            (options.precedence?.length ? `\n\n${options.precedence.join('\n')}` : ''),
          created_at: new Date().toISOString(),
        };

        const response = await api.applyToAnswer({
          inputs: inputsFrom(project),
          active_iteration: asIteration(target.text, versionNumber, project.mode),
          chat_history: [...priorHistory, scoped],
          iteration_number: versionNumber + 1,
          model: project.model,
        });

        const after = response.iteration.output.trim();
        if (!after) {
          if (live.current) setError('The revision came back empty. Try rewording it.');
          return;
        }

        if (!live.current) return;
        const spliced = spliceScope(content, target, after);
        const checked = await checkedRevision(content, spliced, ask, [...inForce(messages).filter((m) => m.role === 'user').map((m) => m.content), ask]);
        if (!live.current) return;
        setProposal({
          // What the user decided travels with the instruction it answered.
          // Saved bare, "Write them as approved" was read by every later
          // prompt as the user's instruction, though they had chosen to keep
          // the recorded approval — and the objective check then held the
          // work to the values they declined (18 Oct, production pass).
          instruction: withDecision(ask, options.precedence),
          target,
          before: describeScope(target),
          after: checked.putBack.length && kind === 'document' ? checked.nextContent : after,
          nextContent: checked.nextContent,
          ...checked.fields,
          baseContent: content,
          ask: { instruction: text, kind, options },
          messageId: saved.id,
          factChanges: await withMeaningChanges(
            factChangesFromRevision({ facts: project.facts, instruction: ask, before: content, after: checked.nextContent }),
            { facts: project.facts, instruction: ask, before: content, after: checked.nextContent, model: project.model },
            (req) => api.revisionFacts(req)
          ),
          changeSummary:
            response.iteration.summary?.trim() ||
            `Revised ${scopeNoun(kind)} from the side chat: ${text}`,
          revisedFrom,
        });
      } catch (err) {
        if (live.current) {
          setError(errorText(err, 'Could not draft that revision. Try again in a moment.'));
        }
      } finally {
        if (live.current) setBusy(false);
      }
    },
    [busy, loading, content, messages, persist, project, versionNumber, checkedRevision, instructionFor]
  );

  /**
   * "Save as New Version" from the original core (PM-10): turn the discussion
   * so far into a revised draft of the whole document. Like an instruction it
   * is only a proposal — it is shown before anything is written.
   */
  const saveDiscussion = useCallback(async () => {
    if (busy || messages.length === 0) return;
    const target = resolveScope(content, 'document', {});
    if (!target) {
      setError('There is no draft here to revise yet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.saveAsNewVersion({
        inputs: inputsFrom(project),
        active_iteration: asIteration(content, versionNumber, project.mode),
        chat_history: asHistory(messages),
        iteration_number: versionNumber + 1,
        model: project.model,
        context: getChatContext?.(),
      });
      const after = response.iteration.output.trim();
      if (!after) {
        if (live.current) setError('The new version came back empty. Try again in a moment.');
        return;
      }
      if (!live.current) return;
      const said = messages.filter((m) => m.role === 'user').map((m) => m.content);
      const checked = await checkedRevision(content, after, said.join('\n'), said);
      if (!live.current) return;
      setProposal({
        instruction: 'Save the discussion as a new version',
        target,
        before: describeScope(target),
        after: checked.nextContent,
        nextContent: checked.nextContent,
        ...checked.fields,
        baseContent: content,
        messageId: null,
        changeSummary: response.iteration.summary?.trim() || 'Revised from the side-chat discussion.',
        source: 'chat_save',
      });
    } catch (err) {
      if (live.current) setError(errorText(err, 'Could not turn the discussion into a new version.'));
    } finally {
      if (live.current) setBusy(false);
    }
  }, [busy, messages, content, project, versionNumber, getChatContext, checkedRevision]);

  /**
   * Accept the proposal: append it as a new version.
   *
   * Appending, not mutating — `artifact_versions` is append-only and the
   * version this replaces stays exactly where it was, which is what
   * "recoverable new version" means in FR-08.
   */
  /** The proposal applied without a click under delegated routine decisions. */
  const autoRef = useRef<ChatProposal | null>(null);

  const accept = useCallback(async (updateFactIds?: readonly string[]) => {
    if (!proposal || !appendStageVersion || busy) return;
    setBusy(true);
    setError(null);

    const previousVersionId = headVersion?.id ?? null;
    try {
      await appendStageVersion(stageId, stageLabel, {
        content: proposal.nextContent,
        source_operation: proposal.source ?? 'chat_instruct',
        ...(proposal.baseContent !== undefined ? { base_content: proposal.baseContent } : {}),
        instruction: proposal.instruction,
        model: project.model,
        mode: project.mode,
        change_summary: proposal.changeSummary,
      });

      // The facts the user kept ticked take the revision's values, in the
      // same step, so no later prompt is told the old ones outrank it.
      const chosen = (proposal.factChanges ?? []).filter((c) => !updateFactIds || updateFactIds.includes(c.fact.id));
      let factsUpdated = 0;
      for (const c of chosen) {
        try {
          const from = { via: 'revision', stage_id: stageId, instruction: proposal.instruction.slice(0, 500) };
          if (isNewFact(c)) await recordFacts(project, [{ statement: c.proposed, kind: c.fact.kind, source_kind: 'user_edit', source_ref: newFactSource(c, from) }]);
          else await supersedeFact(project, c.fact, c.proposed, from);
          factsUpdated += 1;
        } catch {
          // The version is saved; a fact that could not be changed is said below.
        }
      }
      if (chosen.length) await onFactsChanged?.();
      if (factsUpdated < chosen.length && live.current) {
        setError(`The revision was saved, but ${chosen.length - factsUpdated} of the facts could not be updated. Change them in Facts and requirements, or Go will treat the old values as current.`);
      }

      await persist(
        'assistant',
        `Applied to ${proposal.target.label.toLowerCase()}. The previous version is kept and can be restored.` +
          (factsUpdated ? ` Recorded ${factsUpdated === 1 ? 'one fact' : `${factsUpdated} facts`} with it.` : ''),
        'instruct',
        proposal.target.label
      );

      if (proposal.messageId) {
        // Applied, so no longer a pending instruction for the next conflict check.
        const appliedId = proposal.messageId;
        setMessages((prev) => prev.map((m) => (m.id === appliedId ? { ...m, appliedVersionId: previousVersionId ?? '' } : m)));
        // Best-effort breadcrumb; the version is already safely written.
        void markStageChatApplied(
          proposal.messageId,
          previousVersionId ?? '',
          proposal.target.label
        ).catch(() => {});
      }

      if (live.current) {
        setApplied({
          scope: proposal.target.label,
          previousVersionId,
          summary: proposal.changeSummary,
          checks: [
            ...(proposal.putBack?.length && proposal.nextContent !== proposal.withoutPutBack
              ? [{ label: `Kept ${describeLines(proposal.putBack)}, which the change did not ask to remove`, ok: true }]
              : []),
            ...(proposal.addedClaims?.length ? [{ label: `Kept details you did not supply: ${describeLines(proposal.addedClaims.map((c) => c.quote))}`, ok: false }] : []),
            ...(checkRevision?.(proposal.nextContent) ?? []),
          ],
          auto: autoRef.current === proposal,
        });
        setProposal(null);
      }
    } catch (e) {
      // A refusal says why (6 Oct production pass: the stage had been edited
      // under the proposal, and the chat only said "Could not save").
      if (live.current) {
        if (e instanceof RefusedRevision && isStaleBaseRefusal(e.message) && proposal.ask) {
          // Nothing to retype: the same instruction, drafted on the new version.
          // 17 Oct (Sean, FIELDGUIDE): the refusal left him unsure what to
          // press. It says the change is kept and names the one button.
          setError(`${e.message}. Your change is kept but not applied yet — press "Apply my change to the new version" below.`);
          setRedo(proposal.ask);
          setProposal(null);
        } else {
          setError(e instanceof RefusedRevision ? `${e.message}. Draft it again from the current version.` : 'Could not save that revision. Nothing was changed.');
        }
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }, [proposal, appendStageVersion, busy, headVersion?.id, stageId, stageLabel, project, persist, onFactsChanged, checkRevision]);

  // Under delegated routine decisions, a proposal that changes no accepted
  // fact is applied as soon as it is drafted, once (13 Oct). The previous
  // version stays one click away on the notice.
  useEffect(() => {
    if (!autoApply || !proposal || busy || autoRef.current === proposal) return;
    // Details nobody supplied are the user's to keep or take out (14 Oct).
    if (proposal.factChanges?.length || proposal.addedClaims?.length || !appendStageVersion) return;
    autoRef.current = proposal;
    void accept();
  }, [autoApply, proposal, busy, appendStageVersion, accept]);

  /** "Remove them anyway" / "Keep them": whether the lines put back stay put back. */
  const togglePutBack = useCallback(() => {
    setProposal((p) => {
      if (!p?.putBack?.length || p.withoutPutBack === undefined) return p;
      const kept = keepUnasked(p.baseContent ?? content, p.withoutPutBack, '').text;
      const next = p.nextContent === p.withoutPutBack ? kept : p.withoutPutBack;
      return { ...p, nextContent: next, after: p.target.kind === 'document' ? next : p.after };
    });
  }, [content]);

  /**
   * A proposal discarded or taken back to adjust never changed anything: its
   * instruction is marked so, and is no longer sent as history or counted as
   * pending (18 Oct, production pass).
   */
  const setAside = useCallback((p: ChatProposal | null) => {
    const id = p?.messageId;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, discarded: true } : m)));
    // Best-effort, and never in the way of closing the proposal.
    void Promise.resolve().then(() => markStageChatDiscarded(id, p.target.label)).catch(() => undefined);
  }, []);

  /** "Adjust": the instruction back in the box, the proposal set aside, nothing saved. */
  const adjust = useCallback((): string => {
    // The words the user typed, without the recorded decision.
    const text = proposal?.ask?.instruction ?? proposal?.instruction ?? '';
    setAside(proposal);
    setProposal(null);
    setError(null);
    return text;
  }, [proposal, setAside]);

  /**
   * Discard the proposal.
   *
   * Local state only, on purpose: nothing was written when it was proposed, so
   * there is nothing to undo — the artifact is untouched and stays untouched.
   */
  const discard = useCallback(() => {
    setAside(proposal);
    setProposal(null);
    setError(null);
  }, [proposal, setAside]);

  /** FR-08's third verb: put back the version the revision replaced. */
  const undo = useCallback(async () => {
    if (!applied?.previousVersionId || !restoreStageVersion || busy) return;
    setBusy(true);
    try {
      await restoreStageVersion(stageId, applied.previousVersionId);
      if (live.current) setApplied(null);
    } catch {
      if (live.current) setError('Could not restore the previous version.');
    } finally {
      if (live.current) setBusy(false);
    }
  }, [applied, restoreStageVersion, busy, stageId]);

  const dismissApplied = useCallback(() => setApplied(null), []);

  /** "Apply my change to the new version": the refused instruction, drafted again on the current text. */
  const redraft = useCallback(async () => {
    if (!redo) return;
    const ask = redo;
    setRedo(null);
    await propose(ask.instruction, ask.kind, ask.options);
  }, [redo, propose]);

  return {
    instructionFor,
    messages,
    loading,
    busy,
    error,
    proposal,
    applied,
    discuss,
    propose,
    saveDiscussion,
    accept,
    adjust,
    discard,
    togglePutBack,
    undo,
    dismissApplied,
    /** A change refused because the stage moved on, waiting to be drafted again. */
    redo,
    redraft,
    /** True when this surface can write at all. */
    canApply: Boolean(appendStageVersion),
    canUndo: Boolean(restoreStageVersion),
  };
}

/**
 * An instruction as it is recorded on the version it made: with the user's
 * answer to any "which takes priority?" question, so a later prompt never
 * reads a request the user declined as one they gave.
 */
export function withDecision(instruction: string, precedence: readonly string[] | undefined): string {
  const notes = (precedence ?? []).map((n) => n.trim()).filter(Boolean);
  return notes.length ? `${instruction}\n\nDecided when this was applied: ${notes.join(' ')}` : instruction;
}
