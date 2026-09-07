/**
 * Research drafting, end to end.
 *
 * The claim under test is the one that was false before this work landed: a
 * Research project can complete its upstream stages, arrive at drafting, and
 * write something. Twelve stages of planning that ended at "0 of 0 sections
 * written" and a disabled button is what `outline_stage: 'derived'` meant when
 * nothing read it.
 *
 * Driven through the real engine, deliberately. `projectState` projects the
 * stage statuses from an event log built the way the workspace builds one, and
 * `evaluateStage` decides whether drafting may close — so a fixture shaped to
 * make the assertions pass would have to be a fixture that is also a valid
 * event log. The drafting half runs the real `runDrain` against the fake store
 * from the FR-05 suite's lease semantics, because the point of materialising an
 * outline is that Research inherits that machinery unchanged.
 */

import { describe, expect, it } from 'vitest';

import { RESEARCH_V1 } from './templates/research.v1';
import { BOOK_V1 } from './templates/book.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { evaluateStage, projectState } from './engine';
import { deriveOutlineItems, derivedOutlineDrift, draftingStageId, stageBrief } from './derived-outline';
import type { StageArtifactBundle } from './digest';
import type { StageContext, WorkflowEvent } from './types';
import { longFormFromOutline, longFormMatchesOutline, draftBindings } from '@/lib/outline/long-form';
import { parseOutlineDocument, serializeOutlineDocument, staleDrafts } from '@/lib/outline/model';
import { approvedOutlineVersionId, outlineApprovals } from '@/lib/supabase/outline';
import { runDrain } from '@/lib/jobs/drain';
import {
  DRAFT_SECTION,
  type DraftCheckpoint,
  type DraftSectionPayload,
  type Job,
  type JobStore,
  type OutlineSectionState,
  type SectionContext,
  type SectionGenerator,
  type SectionRecord,
  type WriteSectionResult,
} from '@/lib/jobs/types';
import type { Artifact, ArtifactVersion } from '@/types/project';
import type { LongFormState } from '@/types';

// ---------------------------------------------------------------------------
// A project, built the way the workspace builds one
// ---------------------------------------------------------------------------

const PROJECT = 'proj-research';
const ARTIFACT = 'art-paper';

let seq = 0;
function event(
  type: WorkflowEvent['type'],
  stage_id: string,
  extra: Partial<WorkflowEvent> = {}
): WorkflowEvent {
  seq += 1;
  return {
    type,
    stage_id,
    actor: 'user',
    created_at: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    ...extra,
  };
}

/** What each upstream stage concluded, as the summary written at completion. */
const CONCLUSIONS: Record<string, string> = {
  question: 'Does checkpointing at the section boundary preserve completed work across worker death?',
  literature: 'Prior queue designs restart the unit of work; none checkpoint mid-unit.',
  hypothesis: 'Checkpointing at the boundary preserves every completed section; disconfirmed by any regeneration.',
  method: 'Ten-section project, worker killed after section three, resumed; measure regenerated sections.',
  experiment: 'Run 1: killed at section 3, resumed [complete]; Run 2: lease expired, reaped [complete].',
  analysis: 'Supported: three completed sections survived and none were regenerated.',
  alternatives: 'Idempotency key alone could explain it [addressed]; caching at the model [left open].',
  validation: 'Re-ran the ten-section project on a second machine [reproduced].',
  mechanism: 'The lease, not the process, is what holds the claim, so a dead worker releases by expiry.',
  generality: 'Holds where a unit of work is externally durable; fails where the model call is the unit.',
};

/**
 * Complete the Research stages up to drafting, optionally skipping some.
 *
 * Returns exactly what the workspace hands the derivation: the projected state
 * and the per-stage artifact bundles.
 */
function upstream(skip: string[] = []) {
  const events: WorkflowEvent[] = [event('project_created', 'question')];
  const bundles: Record<string, StageArtifactBundle> = {};

  for (const stage of RESEARCH_V1.stages) {
    if (stage.id === 'drafting') break;
    if (skip.includes(stage.id)) {
      events.push(
        event('stage_skipped', stage.id, {
          to_stage_id: stage.transitions.default_next ?? undefined,
          reason: 'Out of scope for this study',
        })
      );
      continue;
    }
    const summary = CONCLUSIONS[stage.id] ?? '';
    bundles[stage.id] = {
      artifact: { id: `art-${stage.id}`, summary } as unknown as Artifact,
      versions: [{ id: `v-${stage.id}`, content: summary } as unknown as ArtifactVersion],
    };
    events.push(
      event('stage_completed', stage.id, {
        to_stage_id: stage.transitions.default_next ?? undefined,
      })
    );
  }

  return { events, bundles, state: projectState(RESEARCH_V1, events) };
}

// ---------------------------------------------------------------------------
// The fake job store: the FR-05 lease semantics, one project
// ---------------------------------------------------------------------------

interface Row extends Job {
  idempotency_key: string;
  leased_until: number | null;
}

class Store implements JobStore {
  jobs: Row[] = [];
  outline: OutlineSectionState[] = [];
  records: SectionRecord[] = [];

  constructor(longForm: LongFormState) {
    this.outline = longForm.outline.map((s) => ({ ...s }));
  }

  enqueue(payload: DraftSectionPayload): void {
    const key = `draft:${payload.outline_version_id ?? 'none'}:${payload.section_id}:${payload.revision}`;
    if (this.jobs.some((j) => j.idempotency_key === key)) return;
    this.jobs.push({
      id: `job-${this.jobs.length}`,
      user_id: 'user-1',
      project_id: PROJECT,
      kind: DRAFT_SECTION,
      status: 'queued',
      payload: payload as unknown as Record<string, unknown>,
      checkpoint: {},
      attempts: 0,
      max_attempts: 3,
      lease_owner: null,
      cancel_requested: false,
      idempotency_key: key,
      leased_until: null,
    });
  }

  async reapExpiredLeases(): Promise<number> {
    return 0;
  }

  async claimNextJob(worker: string, leaseSeconds: number): Promise<Job | null> {
    if (this.jobs.some((j) => j.status === 'leased')) return null;
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return null;
    job.status = 'leased';
    job.lease_owner = worker;
    job.leased_until = Date.now() + leaseSeconds * 1000;
    job.attempts += 1;
    return { ...job };
  }

  private held(jobId: string, worker: string): Row | null {
    const job = this.jobs.find((j) => j.id === jobId);
    return job && job.status === 'leased' && job.lease_owner === worker ? job : null;
  }

  async checkpointJob(jobId: string, worker: string, checkpoint: DraftCheckpoint): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.checkpoint = { ...checkpoint } as unknown as Record<string, unknown>;
    return true;
  }

  async completeJob(jobId: string, worker: string): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = 'succeeded';
    job.lease_owner = null;
    return true;
  }

  async failJob(
    jobId: string,
    worker: string,
    _code: string,
    _message: string,
    _detail: Record<string, unknown>,
    retryable: boolean
  ): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = retryable && job.attempts < job.max_attempts ? 'queued' : 'failed';
    job.lease_owner = null;
    return true;
  }

  async releaseJob(jobId: string, worker: string): Promise<boolean> {
    const job = this.held(jobId, worker);
    if (!job) return false;
    job.status = 'queued';
    job.lease_owner = null;
    job.attempts = Math.max(job.attempts - 1, 0);
    return true;
  }

  async loadSectionContext(payload: DraftSectionPayload): Promise<SectionContext> {
    const idx = this.outline.findIndex((s) => s.id === payload.section_id);
    return {
      outline: this.outline.map((s) => ({ ...s })),
      section: idx >= 0 ? { ...this.outline[idx] } : null,
      records: this.records.filter((r) => r.section_index < payload.section_index),
      prevSectionContent: idx > 0 ? (this.outline[idx - 1].content ?? '') : '',
    };
  }

  async writeSection(args: {
    artifactId: string;
    worker: string;
    sectionId: string;
    content: string;
    finishReason: string;
    outlineVersionId: string | null;
  }): Promise<WriteSectionResult> {
    const idx = this.outline.findIndex((s) => s.id === args.sectionId);
    const section = this.outline[idx];
    section.content = args.content;
    section.status = 'complete';
    section.finish_reason = args.finishReason;
    // The RPC stamps this; the fake has to as well, because "the section
    // records what it was written against" is the assertion.
    section.outline_version_id = args.outlineVersionId;
    section.revision = (section.revision ?? 0) + 1;
    return {
      section_index: idx,
      sections_total: this.outline.length,
      sections_complete: this.outline.filter((s) => s.status === 'complete').length,
    };
  }

  async writeSectionRecord(args: { record: SectionRecord }): Promise<void> {
    this.records.push(args.record);
  }
}

class Generator implements SectionGenerator {
  calls: string[] = [];
  /** Every abstract the generator was given, so the brief can be asserted on. */
  abstracts: string[] = [];

  async generateSectionProse(req: {
    outline: OutlineSectionState[];
    section_index: number;
  }): Promise<{ content: string; finish_reason: string }> {
    const section = req.outline[req.section_index];
    this.calls.push(section.id);
    this.abstracts.push(section.abstract);
    return { content: `Prose for ${section.title}.`, finish_reason: 'stop' };
  }

  async extractSectionRecord(req: {
    section_id: string;
    section_index: number;
    section_title: string;
  }): Promise<{ record: SectionRecord }> {
    return {
      record: {
        section_id: req.section_id,
        section_index: req.section_index,
        title: req.section_title,
        summary: '',
        glossary_terms: [],
        decisions: [],
        todos: [],
      },
    };
  }
}

// ---------------------------------------------------------------------------

describe('outline_stage is read, not merely declared', () => {
  it('routes on the field rather than the template key', () => {
    expect(BOOK_V1.outline_stage).toBe('explicit');
    expect(BOOK_V1.derived_outline).toBeUndefined();

    expect(RESEARCH_V1.outline_stage).toBe('derived');
    expect(RESEARCH_V1.derived_outline?.stage_id).toBe('drafting');

    expect(SINGLE_OUTPUT_V1.outline_stage).toBe('none');
    expect(SINGLE_OUTPUT_V1.derived_outline).toBeUndefined();
  });

  it('derives nothing for a workflow that is not derived', () => {
    const { state, bundles } = upstream();
    expect(deriveOutlineItems(BOOK_V1, state, bundles)).toEqual([]);
    expect(deriveOutlineItems(SINGLE_OUTPUT_V1, state, bundles)).toEqual([]);
  });

  it('names a real stage for every source in the spec', () => {
    const ids = new Set(RESEARCH_V1.stages.map((s) => s.id));
    for (const section of RESEARCH_V1.derived_outline!.sections) {
      for (const from of section.from_stages) expect(ids.has(from)).toBe(true);
    }
  });
});

describe('deriving the outline', () => {
  it('produces every section in template order, each briefed from its stage', () => {
    const { state, bundles } = upstream();
    const items = deriveOutlineItems(RESEARCH_V1, state, bundles);

    expect(items.map((i) => i.id)).toEqual([
      'introduction',
      'related_work',
      'method',
      'results',
      'reproduction',
      'discussion',
      'threats',
      'interpretation',
      'conclusion',
    ]);

    // The brief is the upstream conclusion, verbatim and attributed.
    const results = items.find((i) => i.id === 'results')!;
    expect(results.abstract).toContain(CONCLUSIONS.experiment);
    expect(results.abstract).toContain('Experiment or investigation:');

    // A section drawing on two stages carries both.
    const intro = items.find((i) => i.id === 'introduction')!;
    expect(intro.abstract).toContain(CONCLUSIONS.question);
    expect(intro.abstract).toContain(CONCLUSIONS.hypothesis);
  });

  it('is a pure function: the same inputs give the same outline', () => {
    const { state, bundles } = upstream();
    expect(deriveOutlineItems(RESEARCH_V1, state, bundles)).toEqual(
      deriveOutlineItems(RESEARCH_V1, state, bundles)
    );
  });

  it('takes nothing from a stage that is not complete', () => {
    const { state, bundles } = upstream(['literature']);
    const question = RESEARCH_V1.stages.find((s) => s.id === 'question')!;
    const literature = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;

    expect(stageBrief(question, state, bundles)).toBe(CONCLUSIONS.question);
    expect(stageBrief(literature, state, bundles)).toBe('');
  });
});

describe('a skipped source stage does not produce a broken outline', () => {
  it('drops the optional sections behind it and keeps the rest whole', () => {
    const { state, bundles } = upstream(['literature', 'experiment', 'validation', 'alternatives']);
    const items = deriveOutlineItems(RESEARCH_V1, state, bundles);

    expect(items.map((i) => i.id)).toEqual([
      'introduction',
      'method',
      'discussion',
      'interpretation',
      'conclusion',
    ]);
    // No empty headings, and no section left with a blank brief.
    for (const item of items) {
      expect(item.title.trim()).not.toBe('');
      expect(item.abstract.trim()).not.toBe('');
    }
  });

  it('keeps a required section whose own stage was skipped, guidance intact', () => {
    // hypothesis is skippable and feeds the introduction, which is not.
    const { state, bundles } = upstream(['hypothesis']);
    const intro = deriveOutlineItems(RESEARCH_V1, state, bundles).find(
      (i) => i.id === 'introduction'
    )!;

    expect(intro.abstract).toContain(CONCLUSIONS.question);
    expect(intro.abstract).not.toContain(CONCLUSIONS.hypothesis);
  });

  it('still derives a usable outline when every optional stage was skipped', () => {
    const optional = RESEARCH_V1.stages
      .filter((s) => s.transitions.allow_skip)
      .map((s) => s.id);
    const { state, bundles } = upstream(optional);
    const items = deriveOutlineItems(RESEARCH_V1, state, bundles);

    // The four sections resting on stages that cannot be skipped.
    expect(items.map((i) => i.id)).toEqual(['introduction', 'method', 'discussion', 'conclusion']);
    expect(items.every((i) => i.abstract.trim().length > 0)).toBe(true);
  });
});

describe('derive, approve, draft', () => {
  /** The whole path, as the workspace and the drain walk it. */
  async function run(skip: string[] = []) {
    const { events, bundles, state } = upstream(skip);

    // 1. Derive. No model call is available in this test, and none is needed.
    const items = deriveOutlineItems(RESEARCH_V1, state, bundles);
    const doc = { schema: 1 as const, items, orphans: [] };

    // 2. Commit it as an ordinary outline version.
    const version = {
      id: 'outline-v1',
      artifact_id: 'art-outline',
      version_number: 1,
      content: serializeOutlineDocument(doc),
    } as unknown as ArtifactVersion;

    // 3. Approve it through the ordinary event, which is what drafting binds to.
    const approved = [
      ...events,
      event('outline_approved', 'drafting', {
        payload: {
          outline_version_id: version.id,
          outline_version_number: version.version_number,
          artifact_id: version.artifact_id,
        },
      }),
    ];

    // 4. Materialise into the drafting artifact.
    const longForm = longFormFromOutline(parseOutlineDocument(version.content), null);

    // 5. Draft, through the real drain.
    const store = new Store(longForm);
    const generator = new Generator();
    longForm.outline.forEach((section, index) =>
      store.enqueue({
        project_id: PROJECT,
        artifact_id: ARTIFACT,
        stage_id: 'drafting',
        section_id: section.id,
        section_index: index,
        outline_version_id: approvedOutlineVersionId(approved),
        revision: 0,
        model: 'test-model',
        inputs: {
          objective: CONCLUSIONS.question,
          audience: '',
          constraints: '',
          output_format: '',
          mode: 'architect',
          session_facts: [],
        },
      })
    );

    await runDrain({
      store,
      generator,
      worker: 'worker-1',
      budgetMs: 60_000,
      projectId: PROJECT,
    });

    return { events: approved, version, longForm, store, generator, doc, state, bundles };
  }

  it('binds drafting to an approved outline version and writes against it', async () => {
    const { events, version, store, generator } = await run();

    // The gap this work closes: before it, both of these were null and zero.
    expect(approvedOutlineVersionId(events)).toBe(version.id);
    expect(outlineApprovals(events)).toHaveLength(1);
    expect(store.outline.length).toBeGreaterThan(0);

    // Every section written, and each records the outline it was written against.
    expect(store.outline.every((s) => s.status === 'complete')).toBe(true);
    expect(store.outline.every((s) => s.outline_version_id === version.id)).toBe(true);
    expect(generator.calls).toEqual(store.outline.map((s) => s.id));

    // And the brief travelled: the prompt for Results saw the experiment stage.
    const resultsIdx = store.outline.findIndex((s) => s.id === 'results');
    expect(generator.abstracts[resultsIdx]).toContain(CONCLUSIONS.experiment);
  });

  it('lets the drafting stage close, which it could not before', async () => {
    const { store, state } = await run();

    const context: StageContext = {
      fields: { objective: CONCLUSIONS.question, audience: '', constraints: '' },
      itemCounts: {},
      itemsMissingStatus: {},
      artifactNonEmpty: {},
      outlineApproved: true,
      sectionsTotal: store.outline.length,
      sectionsComplete: store.outline.filter((s) => s.status === 'complete').length,
      findingsTotal: 0,
      findingsTriaged: 0,
      manualChecks: {},
    };

    const evaluation = evaluateStage(RESEARCH_V1, 'drafting', context);
    expect(evaluation.canAdvance).toBe(true);
    expect(state.stages.drafting.status).toBe('in_progress');

    // Sanity: with no sections it is the failure this task started from.
    const empty = evaluateStage(RESEARCH_V1, 'drafting', {
      ...context,
      sectionsTotal: 0,
      sectionsComplete: 0,
    });
    expect(empty.canAdvance).toBe(false);
    expect(empty.unmet[0].detail).toBe('no sections yet');
  });

  it('drafts a skipped-stage project too, with the sections that survived', async () => {
    const { store, version } = await run(['experiment', 'validation']);
    expect(store.outline.map((s) => s.id)).not.toContain('results');
    expect(store.outline.map((s) => s.id)).not.toContain('reproduction');
    expect(store.outline.every((s) => s.outline_version_id === version.id)).toBe(true);
  });
});

describe('upstream changing after approval', () => {
  it('reports the drift rather than re-deriving over an approved outline', () => {
    const { state, bundles } = upstream();
    const approved = deriveOutlineItems(RESEARCH_V1, state, bundles);

    expect(derivedOutlineDrift(approved, approved).stale).toBe(false);

    // The analysis stage is revised after approval.
    const revised = {
      ...bundles,
      analysis: {
        ...bundles.analysis,
        artifact: { ...bundles.analysis.artifact!, summary: 'Not supported after all.' },
      },
    };
    const drift = derivedOutlineDrift(
      approved,
      deriveOutlineItems(RESEARCH_V1, state, revised)
    );

    expect(drift.stale).toBe(true);
    expect(drift.changed.map((i) => i.id).sort()).toEqual(['conclusion', 'discussion']);
    expect(drift.added).toEqual([]);
    expect(drift.removed).toEqual([]);
  });

  it('sees a section appear when a stage is completed later', () => {
    const withoutLit = upstream(['literature']);
    const withLit = upstream();

    const drift = derivedOutlineDrift(
      deriveOutlineItems(RESEARCH_V1, withoutLit.state, withoutLit.bundles),
      deriveOutlineItems(RESEARCH_V1, withLit.state, withLit.bundles)
    );
    expect(drift.added.map((i) => i.id)).toEqual(['related_work']);
  });

  it('never discards sections already written against the approved version', () => {
    const { state, bundles } = upstream();
    const items = deriveOutlineItems(RESEARCH_V1, state, bundles);
    const doc = { schema: 1 as const, items, orphans: [] };

    // Two sections written against outline v1.
    const written = longFormFromOutline(doc, null);
    for (const id of ['introduction', 'method']) {
      const section = written.outline.find((s) => s.id === id)!;
      section.status = 'complete';
      section.content = 'Words that cost money.';
      section.outline_version_id = 'outline-v1';
    }

    // A revised outline is approved: same ids, one brief changed.
    const revised = {
      ...doc,
      items: doc.items.map((i) =>
        i.id === 'method' ? { ...i, abstract: `${i.abstract} (revised)` } : i
      ),
    };
    const after = longFormFromOutline(revised, written);

    const method = after.outline.find((s) => s.id === 'method')!;
    expect(method.content).toBe('Words that cost money.');
    expect(method.status).toBe('complete');
    // The heading follows the approved outline; the prose does not move.
    expect(method.abstract).toContain('(revised)');

    // And the editor can say which prose is now out of step.
    const report = staleDrafts(draftBindings(after), 'outline-v2', []);
    expect(report.stale.map((b) => b.item_id).sort()).toEqual(['introduction', 'method']);
  });

  it('knows when the drafting state already matches the outline', () => {
    const { state, bundles } = upstream();
    const doc = { schema: 1 as const, items: deriveOutlineItems(RESEARCH_V1, state, bundles), orphans: [] };

    expect(longFormMatchesOutline(doc, null)).toBe(false);
    expect(longFormMatchesOutline(doc, longFormFromOutline(doc, null))).toBe(true);
  });
});

describe('where an approved outline is materialised', () => {
  it('sends Book\'s approval to the drafting stage, not the outline stage', () => {
    // Book approves on its own Outline stage but drafts on a later one. Writing
    // long_form onto the outline stage's artifact would leave drafting showing
    // "0 of 0 sections" with an approval in the log saying otherwise — which is
    // why dispatching the outline renderer alone was never enough to wire it.
    const outlineStage = BOOK_V1.stages.find((s) => s.renderer === 'outline');
    expect(outlineStage).toBeDefined();
    expect(draftingStageId(BOOK_V1)).toBe('drafting');
    expect(draftingStageId(BOOK_V1)).not.toBe(outlineStage!.id);
  });

  it('sends a derived approval to the stage the panel already sits on', () => {
    // Research has no separate outline stage: caller and destination coincide,
    // so the same code path needs no special case.
    expect(draftingStageId(RESEARCH_V1)).toBe(RESEARCH_V1.derived_outline?.stage_id);
  });

  it('picks the first drafting stage when a workflow has several', () => {
    // Book drafts, then expands, and both are long_form. Sections are
    // materialised once, by the first.
    const longFormStages = BOOK_V1.stages.filter((s) => s.renderer === 'long_form');
    expect(longFormStages.length).toBeGreaterThan(1);
    expect(draftingStageId(BOOK_V1)).toBe(longFormStages[0].id);
  });

  it('returns null for a workflow that never drafts', () => {
    expect(draftingStageId(SINGLE_OUTPUT_V1)).toBeNull();
  });
});
