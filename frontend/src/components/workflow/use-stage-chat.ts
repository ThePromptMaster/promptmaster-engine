'use client';

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
  saveStageChatMessage,
  type StageChatMessage,
} from '@/lib/supabase/conversation';
import { inputsFrom } from './use-stage-generation';
import {
  describeScope,
  resolveScope,
  scopeNoun,
  spliceScope,
  type ScopeKind,
  type ScopeTarget,
} from './chat-scope';
import type { NewVersion } from '@/lib/supabase/versions';
import type { ArtifactVersion, Project } from '@/types/project';
import type { ChatMessage, Iteration } from '@/types';

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
  /** The message row the instruction was persisted as, to stamp on accept. */
  messageId: string | null;
  changeSummary: string;
}

/** What was applied last, so it can be undone without hunting for it. */
export interface AppliedRevision {
  scope: string;
  /** The version to restore to. Held from *before* the append. */
  previousVersionId: string | null;
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
function asIteration(output: string, number: number, mode: Project['mode']): Iteration {
  return {
    iteration_number: number,
    prompt_sent: '',
    system_prompt_used: '',
    output,
    mode,
    evaluation: null,
  };
}

/** The thread as the backend wants it: role and content, nothing else. */
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
}: Options) {
  const [messages, setMessages] = useState<StageChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ChatProposal | null>(null);
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

  useEffect(() => {
    let current = true;
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
      if (live.current) setMessages((prior) => [...prior, saved]);
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
      if (!message || busy) return;
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
    [busy, messages, persist, project, content, versionNumber]
  );

  /**
   * Draft a revision of one scope and return it for review. Writes nothing.
   *
   * The scope's text is handed to `apply-to-answer` as the version under
   * discussion, so what comes back is a revision *of that passage* rather than
   * of the whole artifact — which is what makes selection and section scopes
   * mean anything.
   */
  const propose = useCallback(
    async (
      instruction: string,
      kind: ScopeKind,
      options: { selection?: string; sectionId?: string } = {}
    ) => {
      const text = instruction.trim();
      if (!text || busy) return;

      const target = resolveScope(content, kind, options);
      if (!target) {
        // Never widen to the whole document. A selection that cannot be found
        // in the source, or a section that has moved, is a refusal.
        setError(
          kind === 'selection'
            ? 'That selection is not in this version of the text. Select inside the artifact and try again.'
            : `There is no ${kind} to revise here yet.`
        );
        return;
      }

      setBusy(true);
      setError(null);

      try {
        const priorHistory = asHistory(messages);
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
            `Instruction: ${text}`,
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
        setProposal({
          instruction: text,
          target,
          before: describeScope(target),
          after,
          nextContent: spliceScope(content, target, after),
          messageId: saved.id,
          changeSummary:
            response.iteration.summary?.trim() ||
            `Revised ${scopeNoun(kind)} from the side chat: ${text}`,
        });
      } catch (err) {
        if (live.current) {
          setError(errorText(err, 'Could not draft that revision. Try again in a moment.'));
        }
      } finally {
        if (live.current) setBusy(false);
      }
    },
    [busy, content, messages, persist, project, versionNumber]
  );

  /**
   * Accept the proposal: append it as a new version.
   *
   * Appending, not mutating — `artifact_versions` is append-only and the
   * version this replaces stays exactly where it was, which is what
   * "recoverable new version" means in FR-08.
   */
  const accept = useCallback(async () => {
    if (!proposal || !appendStageVersion || busy) return;
    setBusy(true);
    setError(null);

    const previousVersionId = headVersion?.id ?? null;
    try {
      await appendStageVersion(stageId, stageLabel, {
        content: proposal.nextContent,
        source_operation: 'chat_instruct',
        instruction: proposal.instruction,
        model: project.model,
        mode: project.mode,
        change_summary: proposal.changeSummary,
      });

      await persist(
        'assistant',
        `Applied to ${proposal.target.label.toLowerCase()}. The previous version is kept and can be restored.`,
        'instruct',
        proposal.target.label
      );

      if (proposal.messageId) {
        // Best-effort breadcrumb; the version is already safely written.
        void markStageChatApplied(
          proposal.messageId,
          previousVersionId ?? '',
          proposal.target.label
        ).catch(() => {});
      }

      if (live.current) {
        setApplied({ scope: proposal.target.label, previousVersionId });
        setProposal(null);
      }
    } catch {
      if (live.current) setError('Could not save that revision. Nothing was changed.');
    } finally {
      if (live.current) setBusy(false);
    }
  }, [proposal, appendStageVersion, busy, headVersion?.id, stageId, stageLabel, project, persist]);

  /**
   * Discard the proposal.
   *
   * Local state only, on purpose: nothing was written when it was proposed, so
   * there is nothing to undo — the artifact is untouched and stays untouched.
   */
  const discard = useCallback(() => {
    setProposal(null);
    setError(null);
  }, []);

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

  return {
    messages,
    loading,
    busy,
    error,
    proposal,
    applied,
    discuss,
    propose,
    accept,
    discard,
    undo,
    dismissApplied,
    /** True when this surface can write at all. */
    canApply: Boolean(appendStageVersion),
    canUndo: Boolean(restoreStageVersion),
  };
}
