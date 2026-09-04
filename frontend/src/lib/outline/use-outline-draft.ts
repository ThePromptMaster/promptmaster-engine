'use client';

import { useCallback, useMemo, useState } from 'react';

import { editModeFor, forkForEdit, sameDocument } from './model';
import type { OutlineDocument } from '@/types/outline';

/**
 * Copy-on-write outline editing, as state.
 *
 * The rule it encodes is the one FR-07 asks for and nothing else enforces:
 * the first edit to an APPROVED outline forks a draft, and every edit after
 * that mutates the draft. Keeping it here rather than inside the editor means
 * it can be tested without a DOM, and means the editor stays a controlled
 * component that any surface can drive.
 */

export interface OutlineDraftState {
  /** What the editor renders: the draft if there is one, else the head version. */
  document: OutlineDocument;
  /** True when there are uncommitted changes. */
  isDraft: boolean;
  /** Set when the draft was cloned from an approved version. */
  forkedFromVersionId: string | null;
}

export interface OutlineEditInput {
  head: OutlineDocument;
  headVersionId: string | null;
  headApproved: boolean;
  draft: OutlineDocument | null;
}

/**
 * Apply an edit, forking if the head is approved.
 *
 * Pure, and separate from the hook, because "editing an approved outline must
 * not mutate it" is a rule about data rather than about React.
 */
export function applyOutlineEdit(
  state: OutlineEditInput,
  next: OutlineDocument
): OutlineDocument | null {
  if (state.draft) {
    // Already a draft: in place. An edit that reverts a draft back to the head
    // clears it, so "unsaved changes" never lingers over an identical document.
    return sameDocument(next, state.head) && !state.headApproved ? null : next;
  }

  if (editModeFor(state.headApproved) === 'fork') {
    return forkForEdit(next, state.headVersionId);
  }
  return sameDocument(next, state.head) ? null : next;
}

export function useOutlineDraft(
  head: OutlineDocument,
  headVersionId: string | null,
  headApproved: boolean,
  initialDraft: OutlineDocument | null = null
) {
  const [draft, setDraft] = useState<OutlineDocument | null>(initialDraft);

  const edit = useCallback(
    (next: OutlineDocument) => {
      setDraft((current) =>
        applyOutlineEdit({ head, headVersionId, headApproved, draft: current }, next)
      );
    },
    [head, headVersionId, headApproved]
  );

  const discard = useCallback(() => setDraft(null), []);

  const state: OutlineDraftState = useMemo(
    () => ({
      document: draft ?? head,
      isDraft: draft !== null,
      forkedFromVersionId: draft?.forked_from_version_id ?? null,
    }),
    [draft, head]
  );

  return { ...state, draft, edit, discard, setDraft };
}
