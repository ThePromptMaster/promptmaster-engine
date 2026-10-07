'use client';

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api/client';
import { BRIEF_FIELDS, finishedConclusions, presentationOnly, type WatchedField } from '@/lib/workflow/brief-change';
import { factsText } from '@/lib/workflow/facts';
import { stagesUsingFacts, statementsOf } from '@/lib/workflow/fact-dependencies';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { NewWorkflowEvent } from '@/lib/supabase/workflow';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';

/** How long a field must stay unchanged before its change is judged: typing is not a change. */
const SETTLE_MS = 2_500;
/** How much of each version a brief_changed event keeps, for reading the brief back. */
const BRIEF_TEXT_KEPT = 20_000;

const WATCHED: readonly WatchedField[] = [...BRIEF_FIELDS, 'facts'];

function watched(project: Project): Record<WatchedField, string> {
  return {
    ...(Object.fromEntries(BRIEF_FIELDS.map((f) => [f, project[f] ?? ''])) as Record<(typeof BRIEF_FIELDS)[number], string>),
    facts: factsText(project.facts),
  };
}

/**
 * A saved change to the brief reopens only the finished work that relied on it
 * (Sean, 5 Oct). Watches the brief fields; once one has settled on a new value,
 * a wording-only edit is recorded and reopens nothing, and anything else is
 * judged against what each finished stage concluded, then recorded. The page
 * re-reads the log, and the projection marks the named stages for a recheck.
 */
export function useBriefChange({
  project,
  template,
  state,
  bundles,
  stageId,
  appendEvent,
  enabled,
}: {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
  stageId: string;
  appendEvent: (event: NewWorkflowEvent) => Promise<unknown>;
  enabled: boolean;
}) {
  const baseline = useRef<Record<WatchedField, string> | null>(null);
  /** When the brief was last edited away from the baseline. */
  const changedAt = useRef<string | null>(null);
  const latest = useRef({ project, template, state, bundles, stageId, appendEvent });
  latest.current = { project, template, state, bundles, stageId, appendEvent };
  const values = watched(project);
  const key = WATCHED.map((f) => values[f]).join('\u0000');

  useEffect(() => {
    if (!baseline.current) {
      baseline.current = watched(project);
      return;
    }
    if (!enabled) return;
    // The latest edit: a stage finished before it was finished on older text.
    const now = watched(project);
    if (WATCHED.some((f) => now[f] !== baseline.current![f])) changedAt.current = new Date().toISOString();
    const timer = setTimeout(() => {
      const { project: p, template: t, state: s, bundles: b, stageId: at, appendEvent: append } = latest.current;
      const was = baseline.current!;
      const is = watched(p);
      const changed = WATCHED.filter((f) => is[f] !== was[f]);
      if (!changed.length) return;
      baseline.current = is;
      const since = changedAt.current ?? new Date().toISOString();
      changedAt.current = null;
      void (async () => {
        for (const field of changed) {
          const before = was[field];
          const after = is[field];
          // The text before and after rides on the event, so a previous brief
          // can be read back (6 Oct: "previous versions remain available").
          const texts = { before: before.slice(0, BRIEF_TEXT_KEPT), after: after.slice(0, BRIEF_TEXT_KEPT) };
          if (presentationOnly(before, after)) {
            await append({ type: 'brief_changed', stage_id: at, payload: { field, kind: 'wording', presentation_only: true, affected: [], ...texts } });
            continue;
          }
          const stages = finishedConclusions(t, s, b, since);
          // A fact changed or taken out (L-52): what used the old value is in
          // the text. Only those stages reopen, each with the sentence; the
          // change is recorded even when nothing is finished yet.
          if (field === 'facts') {
            const after = new Set(statementsOf(is.facts));
            const removed = statementsOf(was.facts).filter((f) => !after.has(f));
            if (removed.length) {
              const affected = stagesUsingFacts(
                removed,
                stages.map((st) => ({ stage_id: st.stage_id, label: st.label, text: b[st.stage_id]?.versions.at(-1)?.content ?? '' }))
              );
              await append({
                type: 'brief_changed', stage_id: at,
                payload: { field, kind: 'fact', presentation_only: false, affected, method: 'fact_match', changed_facts: removed, ...texts },
              });
              continue;
            }
          }
          if (!stages.length) continue;
          try {
            const impact = await api.assessChange({ field, before, after, stages, model: p.model });
            await append({
              type: 'brief_changed', stage_id: at,
              payload: {
                field, kind: impact.kind, presentation_only: false, affected: impact.affected,
                calculations_hold: impact.calculations_hold, had_computed: stages.some((st) => st.computed),
                ...texts,
              },
            });
          } catch {
            // Not being able to judge it is no reason to reopen everything:
            // the change stands, and nothing is marked.
          }
        }
      })();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // The brief's values are the trigger; everything else is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
