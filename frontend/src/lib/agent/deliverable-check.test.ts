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
import { acceptedRowsBefore, checkedVersion, describeCheck, issuesFrom, MAX_CHECK_ROUNDS, roundsUsed, type DeliverableCheckRecord, noAccessClaim, noteQuotesNotInText } from './deliverable-check';

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

describe("the note cites the version it sits in (5 Nov, a six-chapter book test)", () => {
  const chapters = `## Chapter 4\n\n"Following our conversation today, I've approved your request to finish at 2pm every Friday." ${'word '.repeat(220)}\n`;
  const withNote = (note: string) => `${chapters}\n## Review Note: Manuscript Checked Against the Outline\n\n${note}\n`;

  it('finds a passage the note quotes that this version does not hold', () => {
    const text = withNote('Chapter 4 is inconsistent. Sam says, "I\'m approving it at 2:30, not 2." It must follow the outline.');
    expect(noteQuotesNotInText(text)).toEqual(["I'm approving it at 2:30, not 2."]);
  });

  it('a passage it does hold is fine, however its quote marks and capitals differ', () => {
    const text = withNote('Chapter 4 holds: “following our conversation today, I’ve approved your request to finish at 2pm every Friday.”');
    expect(noteQuotesNotInText(text)).toEqual([]);
  });

  it('short phrases in quotes are not passages, and a document with no note has nothing to check', () => {
    expect(noteQuotesNotInText(withNote('It uses the phrase "approved exception" throughout.'))).toEqual([]);
    expect(noteQuotesNotInText('## Chapter 1\n\nHe said "this is not in any other chapter at all".')).toEqual([]);
  });

  it('reads the numbered heading the chapters use, and stops at the next heading', () => {
    const text = `## 1. One\n\nText.\n\n## 8. Review Note\n\nIt quotes "a passage that is not in the text".\n\n## 9. Appendix\n\nIt also says "a passage in the appendix text here".`;
    expect(noteQuotesNotInText(text)).toEqual(['a passage that is not in the text']);
  });

  it('a note saying it could not read the work, beside the work, is an issue', () => {
    const said = 'The text of Chapters 1 to 6 was not in front of me when I wrote it, so I could inspect only the outline.';
    expect(noAccessClaim(withNote(said))).toContain('was not in front of me');
    expect(noAccessClaim(withNote('The chapter text was not available to me.'))).toContain('not available');
  });

  it('is no issue without the work beside it, or about something else', () => {
    expect(noAccessClaim(`## Chapter 1\n\nShort.\n\n## Review note\n\nThe chapter text was not available to me.`)).toBeNull();
    expect(noAccessClaim(withNote('I read all six chapters. No external sources were available to me.'))).toBeNull();
  });
});

describe("a manuscript's own later reviews reach the check (5 Nov)", () => {
  const rows = (id: string) => serializeItems([{ id, finding: `Finding ${id}`, severity: 'minor', status: 'accepted', status_source: 'user' }]);
  const bundles = { continuity: bundle('continuity', rows('c1')), critique: bundle('critique', rows('k1')) };
  const state = (done: Record<string, string>) => ({ stages: Object.fromEntries(Object.entries(done).map(([id, status]) => [id, { status }])) }) as never;

  it('those before the last long-form stage done', () => {
    const rows = acceptedRowsBefore(BOOK_V1, bundles, 'drafting', state({ revision: 'complete' }));
    expect(rows.map((r) => r.id)).toEqual(['c1']);
  });

  it('the later ones too, once Editing is done', () => {
    const rows = acceptedRowsBefore(BOOK_V1, bundles, 'drafting', state({ revision: 'complete', editing: 'complete' }));
    expect(rows.map((r) => r.id)).toEqual(['c1', 'k1']);
  });

  it('none it has not reached yet: nothing has tried to carry them', () => {
    expect(acceptedRowsBefore(BOOK_V1, bundles, 'drafting', state({ revision: 'in_progress' }))).toEqual([]);
  });

  it('without the state, as before', () => {
    expect(acceptedRowsBefore(BOOK_V1, bundles, 'drafting')).toEqual([]);
  });
});
