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
      const key = offerKey(target);
      if (read.has(key)) continue;
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
      void pending.then(done);
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
