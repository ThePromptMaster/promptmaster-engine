/**
 * 1 Nov (Sean): accepted corrections only partly made, and decision rules the
 * memo's own caveats contradict, survived to the final version; and the
 * review needs to stop predictably rather than loop.
 */
import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { serializeItems } from '@/lib/workflow/stage-artifact';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { Artifact, ArtifactVersion } from '@/types/project';
import { acceptedRowsBefore, checkedVersion, describeCheck, issuesFrom, MAX_CHECK_ROUNDS, roundsUsed, type DeliverableCheckRecord } from './deliverable-check';

const bundle = (stageId: string, content: string): StageArtifactBundle => ({
  artifact: { id: `a-${stageId}`, stage_id: stageId, long_form: null } as unknown as Artifact,
  versions: [{ id: `v-${stageId}`, content } as ArtifactVersion],
});

describe('the accepted findings the deliverable must carry', () => {
  const critique = serializeItems([
    { id: 'i4', finding: 'Setup recovery is confused with operating break-even.', suggested_change: 'Separate the two.', severity: 'major', status: 'accepted', status_source: 'user' },
    { id: 'i5', finding: 'Pilot cost assumed.', suggested_change: 'Say it is unknown.', severity: 'minor', status: 'accepted', status_source: 'model' },
    { id: 'i6', finding: 'Proposed only.', severity: 'minor', status: 'accepted', status_source: 'proposed' },
    { id: 'i7', finding: 'Rejected.', severity: 'minor', status: 'rejected', reason: 'No.' },
    { id: 'i8', finding: 'The reserve is $40,000.', severity: 'minor', status: 'accepted', superseded_by: 'The minimum cash reserve is $75,000.' },
  ]);
  it('are the accepted rows before it — by the user or by Go — not proposals, rejections or superseded rows', () => {
    const rows = acceptedRowsBefore(BOOK_V1, { critique: bundle('critique', critique) }, 'final_review');
    expect(rows.map((r) => r.id)).toEqual(['i4', 'i5']);
    expect(rows[0]).toMatchObject({ stage_label: 'Critique', suggested_change: 'Separate the two.' });
  });
});

describe('what the check finds becomes unmet work', () => {
  const rows = [{ id: 'i4', stage_label: 'Check', finding: 'Setup recovery is confused with break-even.', suggested_change: 'Separate the two.' }];
  it('names the finding not carried, and the contradiction with both passages', () => {
    const issues = issuesFrom(
      {
        findings: [{ id: 'i4', verdict: 'not_carried', quote: 'adopt B on a continuing basis', note: '' }],
        contradictions: [{ rule_quote: 'adopt B at $8,000 a month', conflicts_quote: 'does not recover the setup', problem: 'The rule ignores the setup cost.', fix: 'Raise the threshold.' }],
      },
      rows,
      'Final memo'
    );
    expect(issues).toEqual([
      'Accepted finding i4 (Check) is not carried into Final memo: Setup recovery is confused with break-even. — accepted change: Separate the two. — the text still says "adopt B on a continuing basis"',
      'Final memo contradicts itself: "adopt B at $8,000 a month" against "does not recover the setup" — The rule ignores the setup cost. Fix: Raise the threshold.',
    ]);
  });
});

describe('the review is bounded and does not repeat itself', () => {
  const record = (over: Partial<DeliverableCheckRecord>): DeliverableCheckRecord => ({ version_id: 'v1', version_number: 1, accepted: 3, carried: 2, issues: ['x'], ...over });
  const assessed = (runId: string, r: DeliverableCheckRecord, stageId = 'memo') =>
    ({ type: 'objective_assessed', agent_run_id: runId, payload: { basis: { stage_id: stageId }, deliverable_check: r } }) as unknown as WorkflowEvent;

  it('counts the rounds this run sent issues back, on this deliverable only', () => {
    const events = [assessed('r1', record({})), assessed('r1', record({ version_id: 'v2' })), assessed('r2', record({})), assessed('r1', record({ issues: [] })), assessed('r1', record({}), 'other')];
    expect(roundsUsed(events, 'r1', 'memo')).toBe(MAX_CHECK_ROUNDS);
  });

  it('a version already checked keeps its result', () => {
    expect(checkedVersion([assessed('r1', record({ version_id: 'v3', issues: [] }))], 'v3')).toMatchObject({ issues: [] });
    expect(checkedVersion([assessed('r1', record({ version_id: 'v3', failed: true }))], 'v3')).toBeNull();
  });

  it('says what it found; once bounded, the issues are stated limitations', () => {
    expect(describeCheck(record({ issues: [] }), 'Final memo')).toBe(' Checked: 2 of 3 accepted findings shown carried into Final memo v1; no contradiction found.');
    expect(describeCheck(record({ bounded: true }), 'Final memo')).toBe(' Checked: 2 of 3 accepted findings shown carried into Final memo v1. Still open after 2 repair rounds, so stated as limitations: x.');
    expect(describeCheck(record({ failed: true }), 'Final memo')).toContain('could not run, so nothing was concluded from it');
  });
});
