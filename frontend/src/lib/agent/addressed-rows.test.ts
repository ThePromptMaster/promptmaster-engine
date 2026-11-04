import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({ api: {} }));

import { performStep, type PerformContext } from './perform';
import { addressedRows, carriedOutReason, describeAddressed } from './addressed-rows';
import type { OpenRow } from './needs';
import { parseItems, serializeItems, type StageItem } from '@/lib/workflow/stage-artifact';
import { CARRIED_OUT_REASON, onlyRecordsCarriedOut } from '@/lib/workflow/triage';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/**
 * 4 Nov, production (Lakeside proposal copy): Go fixed Session 1's timings and
 * the length on Final proposal itself, checked it, and asked for approval. Check's
 * i10 ("Session 1 timings sum to 105") and i11 ("about 720 words") were still
 * listed as "Still undecided before you approve", under a version where Session 1
 * summed to 90 and the measured count was 629.
 */

const I10 = 'Session 1 timings sum to 105, not the stated 90: 10 + 20 + 35 + 15 (break) + 15 + 10 = 105.';
const I11 = 'Word count estimate for v3 is about 720, roughly ±40. This is a hand estimate, not measured by a tool.';
const I12 = 'Section 6 does not list AI tool access as an item to confirm.';

const FINAL =
  '## 3. Agenda\n\n### Session 1\n\n| Segment | Minutes |\n|---|---|\n| Welcome | 5 |\n| Exercise 1 | 30 |\n| Break | 10 |\n' +
  '| **Session total** | **90** |\n\n## 6. Items to confirm\n\n- Room and equipment\n';

const MEASURED = [{ id: 'measured.words', label: 'at most 650 words (headings included)', satisfied: true, value: '629 words' }];

const row = (id: string, text: string): OpenRow => ({ stageId: 'proposal_check', stageLabel: 'Check', id, text, severity: 'major' });
const OPEN = [row('i10', I10), row('i11', I11), row('i12', I12)];

describe('rows the current version already carries out', () => {
  it('keeps a row shown by the words of the version, or by a requirement measured as met', () => {
    const got = addressedRows(OPEN, [{ id: 'i10', quote: 'Session total | 90' }, { id: 'i11', quotes: ['629 words'] }], FINAL, MEASURED);
    expect(got.map((r) => [r.id, r.evidence.map((e) => e.measured)])).toEqual([['i10', [false]], ['i11', [true]]]);
  });

  it('a row naming several problems is shown by a quote for each, every one borne out (4 Nov, the next pass)', () => {
    // i10 as rechecked: Session 1's timings, the Option A line, AI tool access.
    const text = `${FINAL}- **AI tool access:** Which tool participants will use, and device access for each participant.\n`;
    const quotes = ['| **Session total** | **90** |', '**AI tool access:** Which tool participants will use'];
    const [r] = addressedRows(OPEN, [{ id: 'i10', quotes }], text, MEASURED);
    expect(r.evidence.map((e) => e.quote)).toEqual(quotes);
    expect(describeAddressed([r])).toContain('— this version: it says “| **Session total** | **90** |”, “**AI tool access:** Which tool participants will use”');
    // One quote the version does not bear out, and the row is not shown at all.
    expect(addressedRows(OPEN, [{ id: 'i10', quotes: [quotes[0], 'Session 1 now totals 90 minutes'] }], text)).toEqual([]);
    // More than three is not a row.
    expect(addressedRows(OPEN, [{ id: 'i10', quotes: [quotes[0], quotes[0], quotes[0], quotes[0]] }], text)).toEqual([]);
  });

  it('drops a quote the version does not contain, one too short, an unknown or repeated id, and anything not a pair', () => {
    expect(addressedRows(OPEN, [{ id: 'i12', quote: 'AI tool access: confirm which tool' }], FINAL, MEASURED)).toEqual([]);
    expect(addressedRows(OPEN, [{ id: 'i10', quote: '90' }], FINAL)).toEqual([]);
    expect(addressedRows(OPEN, [{ id: 'i99', quote: 'Session total | 90' }], FINAL)).toEqual([]);
    expect(addressedRows(OPEN, [{ id: 'i10', quote: 'Session total | 90' }, { id: 'i10', quote: 'Room and equipment' }], FINAL)).toHaveLength(1);
    expect(addressedRows(OPEN, ['i10', null, { id: 'i10' }], FINAL)).toEqual([]);
    expect(addressedRows(OPEN, 'i10', FINAL)).toEqual([]);
    // A measurement not met shows nothing.
    expect(addressedRows(OPEN, [{ id: 'i11', quote: '629 words' }], FINAL, [{ ...MEASURED[0], satisfied: false }])).toEqual([]);
  });

  it('the same id on two review stages names neither', () => {
    const twice = [...OPEN, { ...row('i10', 'Another table'), stageId: 'final_review', stageLabel: 'Final review' }];
    expect(addressedRows(twice, [{ id: 'i10', quote: 'Session total | 90' }], FINAL)).toEqual([]);
  });

  it('a version that only records them as accepted reopens nothing after it; any other change does', () => {
    const before: StageItem[] = [
      { id: 'i9', finding: 'Pricing checks out.', severity: 'minor', status: 'accepted', status_source: 'model' },
      { id: 'i10', finding: I10, severity: 'major' },
    ];
    const [r] = addressedRows(OPEN, [{ id: 'i10', quote: 'Session total | 90' }], FINAL);
    const reason = carriedOutReason(r, 'Final proposal', 7);
    expect(reason.startsWith(`${CARRIED_OUT_REASON} Final proposal v7: it says “Session total | 90”.`)).toBe(true);
    expect(carriedOutReason({ ...r, evidence: [...r.evidence, { quote: 'at most 650 words', measured: true }] }, 'Final proposal', 7))
      .toContain('it says “Session total | 90”; measured in code “at most 650 words”.');
    const recorded = before.map((i) => (i.id === 'i10' ? { ...i, status: 'accepted', status_source: 'model', reason } : i));
    expect(onlyRecordsCarriedOut(serializeItems(before), serializeItems(recorded))).toBe(true);
    // Rejected, or the user's own decision, or a reworded finding: an ordinary save.
    expect(onlyRecordsCarriedOut(serializeItems(before), serializeItems(recorded.map((i) => (i.id === 'i10' ? { ...i, status: 'rejected' } : i))))).toBe(false);
    expect(onlyRecordsCarriedOut(serializeItems(before), serializeItems(recorded.map((i) => (i.id === 'i10' ? { ...i, status_source: 'user' } : i))))).toBe(false);
    expect(onlyRecordsCarriedOut(serializeItems(before), serializeItems(recorded.map((i) => (i.id === 'i10' ? { ...i, finding: 'Changed' } : i))))).toBe(false);
    // A row already decided is not re-decided this way.
    const decidedBefore = before.map((i) => (i.id === 'i10' ? { ...i, status: 'deferred', reason: 'Later' } : i));
    expect(onlyRecordsCarriedOut(serializeItems(decidedBefore), serializeItems(recorded))).toBe(false);
    expect(onlyRecordsCarriedOut(serializeItems(before), serializeItems(before))).toBe(false);
  });
});

// --- Go's approval question on the deliverable ---------------------------------

const TEMPLATE = {
  key: 'custom_lakeside', label: 'Client proposal', version: 1,
  stages: [
    {
      id: 'proposal_check', label: 'Check', short_label: 'Check', renderer: 'review', required: true,
      expected_artifacts: [{ kind: 'critique_report', cardinality: 'one', primary: true }], exit_criteria: [], transitions: {},
    },
    {
      id: 'final_proposal', label: 'Final proposal', short_label: 'Final', renderer: 'prose', required: true,
      expected_artifacts: [{ kind: 'document', cardinality: 'one', primary: true }], exit_criteria: [], transitions: {},
    },
  ],
} as unknown as WorkflowTemplate;

const CHECK_ROWS: StageItem[] = [
  { id: 'i9', finding: 'Pricing checks out at 24 participants.', severity: 'minor', status: 'accepted', status_source: 'model' },
  { id: 'i10', finding: I10, severity: 'major', suggested_change: 'Remove 15 minutes from Session 1.' },
  { id: 'i11', finding: I11, severity: 'major', suggested_change: 'Cut about 100 words.' },
  { id: 'i12', finding: I12, severity: 'major', suggested_change: 'Add AI tool access to section 6.' },
];

const appendStageVersion = vi.fn(async (...args: unknown[]) => ({ id: 'check-v4', args: args.length }));

function ctx(policy: 'autonomous' | 'guided', rowsAddressed: unknown): PerformContext {
  const stage = TEMPLATE.stages[1];
  return {
    project: { id: 'p', user_id: 'u', objective: 'A client proposal', model: 'm', routine_decisions: 'handle', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {} },
    template: TEMPLATE,
    state: { current_stage_id: stage.id, stages: { proposal_check: { status: 'completed' }, final_proposal: { status: 'completed' } } },
    stage,
    bundles: {
      proposal_check: { artifact: null, versions: [{ id: 'check-v3', version_number: 3, content: serializeItems(CHECK_ROWS), source_operation: 'agent_revise', created_at: '2026-11-04T13:55:00Z' }] },
      final_proposal: { artifact: null, versions: [{ id: 'final-v7', version_number: 7, content: FINAL, source_operation: 'agent_revise', created_at: '2026-11-04T14:03:38Z' }] },
    },
    context: {
      fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, manualChecks: {},
      findings: { proposal_check: { total: 4, triaged: 1 } },
      openRows: { proposal_check: CHECK_ROWS.slice(1).map((i) => ({ id: i.id, text: i.finding!, severity: 'major' })) },
      measured: { final_proposal: MEASURED },
    },
    approvedOutline: [],
    run: { id: 'run1', policy },
    step: {
      action_key: 'request_user_decision',
      params: { rows_addressed: rowsAddressed },
      decision_question: 'Do you approve this shorter version (v7) as the finished proposal?',
      rationale: 'Only you can approve it.',
    },
    digest: { recent_steps: [], controls: [] },
    approvedByUser: false,
    deliverableDone: true,
    appendStageVersion,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => appendStageVersion.mockClear());

describe('the approval question on the deliverable (4 Nov)', () => {
  const both = [{ id: 'i10', quote: 'Session total | 90' }, { id: 'i11', quote: '629 words' }];

  it('under the routine-decision policy, rows it carries out are recorded as accepted and not listed as undecided', async () => {
    const out = await performStep(ctx('autonomous', both));
    expect(out.status).toBe('succeeded');
    expect(appendStageVersion).toHaveBeenCalledTimes(1);
    const [stageId, , saved] = appendStageVersion.mock.calls[0] as [string, string, { content: string; source_operation: string; change_summary: string }];
    expect(stageId).toBe('proposal_check');
    expect(saved.source_operation).toBe('agent_triage');
    const rows = parseItems(saved.content)!;
    expect(rows.find((r) => r.id === 'i10')).toMatchObject({ status: 'accepted', status_source: 'model' });
    expect(rows.find((r) => r.id === 'i10')!.reason).toContain('Already carried out in Final proposal v7: it says “Session total | 90”');
    expect(rows.find((r) => r.id === 'i11')!.reason).toContain('measured in code “629 words”');
    expect(rows.find((r) => r.id === 'i12')!.status).toBeUndefined();
    // The save reopens nothing after Check.
    expect(onlyRecordsCarriedOut(serializeItems(CHECK_ROWS), saved.content)).toBe(true);

    const q = out.stop?.reason ?? '';
    expect(q).toContain('Still undecided before you approve: i12 (Check)');
    expect(q).not.toMatch(/Still undecided before you approve:[^\n]*i10/);
    expect(q).toContain('Already carried out in this version, so recorded as accepted on Check under your routine-decision policy');
    expect(q).toContain('i10 (Check) — “Session 1 timings sum to 105');
    expect(out.changes).toEqual({ version_ids: ['check-v4'], items_triaged: ['i10', 'i11'] });
  });

  it('a row the planner cannot show stays undecided, and is listed as before', async () => {
    const out = await performStep(ctx('autonomous', [{ id: 'i10', quote: 'Session 1 now totals 90 minutes' }]));
    expect(appendStageVersion).not.toHaveBeenCalled();
    expect(out.stop?.reason).toMatch(/Still undecided before you approve: i10 \(Check\)[^\n]*i11 \(Check\)[^\n]*i12 \(Check\)/);
    expect(out.changes).toEqual({});
  });

  it('under "ask me" nothing is recorded: the rows are named as carried out, for the user to accept', async () => {
    const out = await performStep(ctx('guided', both));
    expect(appendStageVersion).not.toHaveBeenCalled();
    const q = out.stop?.reason ?? '';
    expect(q).toContain('Still undecided before you approve: i12 (Check)');
    expect(q).toContain('Undecided on Check, though this version already carries them out: i10 (Check)');
    expect(q).toContain('Accept them there; approving now leaves them open.');
  });

  it('a save that fails leaves the rows undecided and named as carried out', async () => {
    appendStageVersion.mockRejectedValueOnce(new Error('conflict'));
    const out = await performStep(ctx('autonomous', both));
    expect(out.stop?.reason).toContain('Undecided on Check, though this version already carries them out');
    expect(out.changes).toEqual({});
  });
});
