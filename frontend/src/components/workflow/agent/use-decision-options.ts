'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { offerKey, type DecisionOffer, type DecisionOption, type DecisionTarget } from '@/lib/workflow/decision-options';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { Project } from '@/types/project';

type Read = { question: string; options: DecisionOption[] };

// Read once per approval and text, for the whole page: Go's card and the
// stage's checklist show the same options, and reopening a paused run reads
// them again only if the text changed (12 Nov).
const read = new Map<string, Read>();
const reading = new Map<string, Promise<void>>();

/** For tests: what was read is forgotten. */
export function forgetDecisionOptions(): void {
  read.clear();
  reading.clear();
}

/** The read for one approval and text, started once and shared by every caller. */
function startRead(project: Project, target: DecisionTarget): Promise<void> {
  const key = offerKey(target);
  let pending = reading.get(key);
  if (!pending) {
    pending = api
      .agentDecisionOptions({
        inputs: inputsFrom(project), approval: target.approval, stage_label: target.stageLabel,
        content: target.content.slice(0, 400_000), model: project.model,
      })
      .then((r) => {
        read.set(key, { question: r?.question ?? '', options: Array.isArray(r?.options) ? r.options.filter((o) => o?.label && o?.quote).slice(0, 4) : [] });
      })
      .catch(() => {
        read.set(key, { question: '', options: [] });
      })
      .finally(() => {
        reading.delete(key);
      });
    reading.set(key, pending);
  }
  return pending;
}

/** What was read for an approval on a version, if it has been (L-274: a pressed or typed choice is checked against it). */
export function cachedDecisionOffer(criterionId: string, versionId: string | null | undefined): Read | null {
  return versionId ? read.get(`${criterionId}:${versionId}`) ?? null : null;
}

/**
 * The options an approval offers on its stage's text, read now if no page has
 * yet (L-275: a typed answer may be the decision on an approval that is not on
 * screen). Never throws: a failed read is no options.
 */
export async function readDecisionOffer(project: Project, target: DecisionTarget): Promise<Read> {
  const key = offerKey(target);
  if (!read.has(key)) await startRead(project, target);
  return read.get(key) ?? { question: '', options: [] };
}

/**
 * The options each waiting reserved approval offers, by criterion id. Nothing
 * is stored on the run: a card for a run paused before this existed gets its
 * options the moment it is opened. A failed read is "no options", and the
 * plain approval is shown.
 */
export function useDecisionOptions(project: Project, targets: readonly DecisionTarget[]): Record<string, DecisionOffer> {
  const [, bump] = useState(0);
  const keys = targets.map(offerKey).join('|');
  useEffect(() => {
    let live = true;
    const done = () => {
      if (live) bump((n) => n + 1);
    };
    for (const target of targets) {
      if (read.has(offerKey(target))) continue;
      void startRead(project, target).then(done);
    }
    return () => {
      live = false;
    };
    // The targets are named by their keys: the same approvals on the same text are the same work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  const out: Record<string, DecisionOffer> = {};
  for (const target of targets) {
    const got = read.get(offerKey(target));
    out[target.criterionId] = got ? { ...got, loading: false } : { question: '', options: [], loading: true };
  }
  return out;
}
