'use client';

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api/client';
import { factsToCheck, lowerStatement, mismatchesToRead, rulesFingerprint, rulesToReadAgainst } from '@/lib/folders/holds';
import { levelWords } from '@/lib/folders/inheritance';
import { recordConflicts } from '@/lib/supabase/folder-rules';
import type { NewWorkflowEvent } from '@/lib/supabase/workflow';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';

/**
 * Reads the project's own facts against the rules its folders hand down, and
 * works out which stages wait on a mismatch the user has not chosen (Sean, 23
 * Nov: "surface both ... pause the reference work that depends on the answer
 * and let the rest of the search continue"; L-280).
 *
 * Each fact is read once against a set of rules (`inherited_checked`); a new or
 * changed rule is a new set, so the facts are read again. Each open mismatch has
 * its stages read once (`inherited_hold`). A call that did not run records
 * nothing, and is made again next time the project opens. Nothing here chooses:
 * the choice is the user's, on the page.
 */
export function useInheritedChecks(input: {
  project: Project;
  template: WorkflowTemplate;
  events: readonly WorkflowEvent[] | null;
  stageId: string;
  enabled: boolean;
  appendEvent: (e: NewWorkflowEvent) => Promise<unknown>;
  onReload?: () => Promise<void> | void;
}): void {
  const { project, template, events, stageId, enabled, appendEvent, onReload } = input;
  const running = useRef(new Set<string>());
  const inherited = project.inherited;

  // A fact against the folders' rules.
  useEffect(() => {
    if (!enabled || !events || !inherited) return;
    const rules = rulesToReadAgainst(inherited);
    if (!rules.length) return;
    const fp = rulesFingerprint(rules);
    const todo = factsToCheck(project.facts, events, fp);
    if (!todo.length) return;
    const key = `facts:${fp}:${todo.map((f) => f.id).join(',')}`;
    if (running.current.has(key)) return;
    running.current.add(key);
    void (async () => {
      try {
        const res = await api.inheritedMismatches({
          rules: rules.slice(0, 100).map((r) => ({ id: r.fact.id, statement: r.fact.statement, scope: levelWords(r.level), required: r.fact.required })),
          statements: todo.slice(0, 30).map((f) => ({ id: f.id, statement: f.statement, place: 'this project', kind: 'new' as const })),
          model: project.model || undefined,
        });
        if (!res.checked) return;
        await recordConflicts(project.user_id, res.mismatches.map((m) => ({
          upper_fact_id: m.rule_id, lower_project_fact_id: m.statement_id,
          upper_quote: m.rule_quote, lower_quote: m.statement_quote, explanation: m.explanation ?? '',
        })));
        await appendEvent({ type: 'inherited_checked', stage_id: stageId, actor: 'system', payload: { rules_fp: fp, fact_ids: todo.slice(0, 30).map((f) => f.id) } });
        if (res.mismatches.length) await onReload?.();
      } catch {
        // Read again next time: nothing was recorded as read.
        running.current.delete(key);
      }
    })();
  }, [enabled, events, inherited, project.facts, project.model, project.user_id, stageId, appendEvent, onReload]);

  // A mismatch's stages.
  useEffect(() => {
    if (!enabled || !events || !inherited) return;
    const toRead = mismatchesToRead(inherited, events);
    if (!toRead.length) return;
    const stages = template.stages.map((s) => ({ id: s.id, label: s.label, instruction: [s.entry_guidance ?? '', s.entry_prompt_hint ?? ''].filter(Boolean).join('\n') }));
    void (async () => {
      for (const m of toRead) {
        const key = `hold:${m.conflict.id}`;
        if (running.current.has(key)) continue;
        running.current.add(key);
        try {
          const res = await api.agentStagesConcerned({
            rule: m.upper.fact.statement, statement: lowerStatement(m), explanation: m.conflict.explanation,
            stages: stages.slice(0, 30), model: project.model || undefined,
          });
          if (!res.checked) {
            running.current.delete(key);
            continue;
          }
          await appendEvent({ type: 'inherited_hold', stage_id: stageId, actor: 'system', payload: { conflict_id: m.conflict.id, stages: res.stages } });
        } catch {
          running.current.delete(key);
        }
      }
    })();
  }, [enabled, events, inherited, template, project.model, stageId, appendEvent]);
}
