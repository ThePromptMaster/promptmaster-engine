'use client';

/**
 * Design preview. Dev-only — see the notFound() guard below.
 *
 * Renders the real workflow components against fixture data so the UI can be
 * reviewed without a login. Every surface here imports the same component the
 * app does, so what you see is what ships; only the data is fabricated.
 */

import { notFound } from 'next/navigation';
import { useState } from 'react';

import { WorkflowPicker } from '@/components/projects/workflow-picker';
import { StageRail } from '@/components/workflow/stage-rail';
import { StageHeader } from '@/components/workflow/stage-header';
import { ExitCriteriaChecklist } from '@/components/workflow/exit-criteria-checklist';
import { StageTransitionBar } from '@/components/workflow/stage-transition-bar';
import {
  BOOK_V1,
  RESEARCH_V1,
  SINGLE_OUTPUT_V1,
  availableTransitions,
  evaluateStage,
  getStage,
  nextSuggestedStage,
  progressSummary,
  projectState,
} from '@/lib/workflow';
import type { StageContext, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';

const TEMPLATES = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1].map((t, i) => ({
  ...t,
  id: `tpl-${i}`,
}));

const ev = (
  type: WorkflowEvent['type'],
  stage_id: string,
  extra: Partial<WorkflowEvent> = {}
): WorkflowEvent => ({
  type,
  stage_id,
  actor: 'user',
  created_at: '2026-09-04T00:00:00Z',
  ...extra,
});

/** A book part-way through: two stages done, one skipped with a reason. */
const EVENTS: WorkflowEvent[] = [
  ev('stage_completed', 'objective', { to_stage_id: 'audience' }),
  ev('stage_completed', 'audience', { to_stage_id: 'positioning' }),
  ev('stage_skipped', 'positioning', { to_stage_id: 'research', reason: 'Not a commercial book' }),
];

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    fields: { objective: 'A field guide to governing AI-assisted work.' },
    itemCounts: { research: 1 },
    itemsMissingStatus: {},
    artifactNonEmpty: {},
    outlineApproved: false,
    sectionsTotal: 0,
    sectionsComplete: 0,
    findingsTotal: 0,
    findingsTriaged: 0,
    manualChecks: {},
    ...overrides,
  };
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-headline text-[var(--on-surface)]">{title}</h2>
      {note && <p className="mt-1 mb-5 text-body text-[var(--on-surface-variant)]">{note}</p>}
      <div className={note ? '' : 'mt-5'}>{children}</div>
    </section>
  );
}

function WorkflowSlice({ template }: { template: WorkflowTemplate }) {
  const events = template.key === 'book' ? EVENTS : [];
  const state = projectState(template, events);
  const stage = getStage(template, state.current_stage_id)!;
  const context = ctx();
  const evaluation = evaluateStage(template, stage.id, context);
  const transitions = availableTransitions(template, state, evaluation);
  const progress = progressSummary(template, state);
  const manualIds = new Set(
    stage.exit_criteria.filter((c) => c.check === 'manual').map((c) => c.id)
  );

  return (
    <div className="flex overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-16px_rgba(25,28,30,0.25)]">
      <aside className="w-[248px] shrink-0 self-start bg-[var(--surface-container-lowest)] px-2 py-6">
        <div className="mb-4 px-3">
          <div className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            {template.name}
          </div>
          <div className="mt-1 text-label text-[var(--on-surface-variant)]">
            {progress.complete} done
            {progress.skipped > 0 && ` · ${progress.skipped} skipped`}
            {` · ${progress.remaining} to go`}
          </div>
        </div>
        <StageRail
          template={template}
          state={state}
          nextSuggestedId={nextSuggestedStage(template, state)}
          onSelect={() => {}}
        />
      </aside>

      <main className="min-w-0 flex-1 px-8 py-8">
        <StageHeader
          stage={stage}
          status={state.stages[stage.id]?.status ?? 'not_started'}
          position={{
            index: template.stages.findIndex((x) => x.id === stage.id) + 1,
            total: template.stages.length,
          }}
        />
        <div className="mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-6 py-6">
          <div className="mb-3 text-label uppercase tracking-wider text-[var(--on-surface-variant)] opacity-70">
            {stage.renderer} renderer
          </div>
          <div className="space-y-2.5" aria-hidden>
            {[100, 92, 96, 74, 88, 60].map((w, i) => (
              <div
                key={i}
                className="h-3 rounded bg-[var(--surface-container-high)]"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <ExitCriteriaChecklist
            criteria={evaluation.criteria}
            manualIds={manualIds}
            onToggleManual={() => {}}
          />
          <StageTransitionBar
            stage={stage}
            evaluation={evaluation}
            options={transitions}
            onTransition={() => {}}
          />
        </div>
      </main>
    </div>
  );
}

export default function PreviewPage() {
  // Never ships. The preview exists so the UI can be reviewed without a login;
  // exposing fixture-driven screens in production would be worse than useless.
  if (process.env.NODE_ENV === 'production') notFound();

  const [pickerId, setPickerId] = useState<string | null>(TEMPLATES[0].id);

  return (
    <div className="min-h-screen bg-[var(--surface)] px-8 py-12">
      <div className="mx-auto max-w-[1200px]">
        <p className="mb-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          Design preview · fixture data · not deployed
        </p>
        <h1 className="text-display text-[var(--on-surface)]">Phase 2 workflow UI</h1>

        <div className="mt-14">
          <Section
            title="Choosing a workflow"
            note="Shown at project creation. The cards show the shape of the work, not just its name."
          >
            <WorkflowPicker templates={TEMPLATES} selectedId={pickerId} onSelect={setPickerId} />
          </Section>

          <Section
            title="Book, three stages in"
            note="Objective and Audience complete, Positioning skipped with a reason, now on Research. The rail groups 13 stages into phases."
          >
            <WorkflowSlice template={BOOK_V1} />
          </Section>

          <Section
            title="Research, on the same engine"
            note="Different stages, different criteria — identical components. Nothing below branches on which workflow it is."
          >
            <WorkflowSlice template={RESEARCH_V1} />
          </Section>

          <Section
            title="The legacy flow, now a template"
            note="The old five-phase session expressed as workflow data rather than a hard-coded path."
          >
            <WorkflowSlice template={SINGLE_OUTPUT_V1} />
          </Section>
        </div>
      </div>
    </div>
  );
}
