import { describe, expect, it } from 'vitest';

import { approverFindings, approversNamed, missedApprovals, MISSED_APPROVER, rolesNamed, unsupportedApprovers } from './approver-support';

// 15 Oct (Sean, HARBOR): "One version named Elena as the original $40,000
// budget approver, although the baseline did not identify that approver."
const baseline = 'Project HARBOR baseline: launch November 20, 2026; approved budget $40,000. Actual spending as of November 2 was $15,000.';
const draft = 'The original $40,000 budget was approved by Elena on the baseline. Launch moved to November 24 after Elena approved the change.';

describe('an approver must have a source', () => {
  it('names the people a text gives as approvers, not those it says have not approved', () => {
    expect(approversNamed(draft)).toEqual(['Elena']);
    expect(approversNamed("Omar's proposal has not been approved. Elena hasn't approved $46,000.")).toEqual([]);
    expect(approversNamed("Approver: Priya. Marco's sign-off is recorded.")).toEqual(['Priya', 'Marco']);
  });

  it('flags Elena when nothing in the project says she approved anything', () => {
    expect(unsupportedApprovers(draft, [baseline])).toEqual(['Elena']);
    const [finding] = approverFindings(draft, [baseline]);
    expect(finding.summary).toMatch(/^Elena is named as approving something/);
    expect(finding.suggested_change).toContain('approver not specified');
  });

  it('is satisfied once a fact names her as approving', () => {
    expect(approverFindings(draft, [baseline, 'Elena approved changing launch to November 24, 2026 and the budget to $44,000.'])).toEqual([]);
  });
});

// 18 Oct (Sean, Summit): the decision log said the analysis approver was
// unknown while quoting the board's authorization. Roles are approvers too.
describe('roles are approvers', () => {
  const facts = [
    'The board authorized management to schedule a process-improvement analysis this quarter.',
    'The CEO authorizes the process-improvement initiative for up to 75 staff hours over five weeks.',
  ];

  it('reads the board and the CEO as approvers, and the negated COO as none', () => {
    expect(rolesNamed('The analysis was authorized by the Board of Directors. The CEO approved 75 hours.')).toEqual(['board', 'CEO']);
    expect(rolesNamed('The COO has not approved the order.')).toEqual([]);
  });

  it('flags a role named as approving when the material records no approval by it', () => {
    expect(unsupportedApprovers('The $900,000 inspection system was approved by the CFO.', facts)).toEqual(['the CFO']);
    expect(unsupportedApprovers('Process-improvement analysis: authorized by the board.', facts)).toEqual([]);
  });

  it('flags "approver unknown" on an item the material records as authorized', () => {
    const log = 'Decision: schedule the process-improvement analysis. Approver: unknown. The machine order is not approved.';
    const [finding] = approverFindings(log, facts).filter((f) => f.category === MISSED_APPROVER);
    expect(finding.summary).toContain('The board authorized management to schedule a process-improvement analysis');
    expect(approverFindings('Machine order: approver not recorded.', facts).filter((f) => f.category === MISSED_APPROVER)).toEqual([]);
  });

  it('matches on a shared figure', () => {
    expect(missedApprovals('The 75 hours have an approver not recorded.', facts)).toHaveLength(1);
  });
});

// 12 Nov (a client, an executive-search simulation): the fact began "Original
// approved plan:", the check read a person called Original, and a decision log
// that rightly said "approver not recorded" was told to name the approver on
// record. The fix wrote "Approver: to confirm", and the routine approval was
// refused over it.
describe('"approved" in front of the thing it describes names nobody', () => {
  const fact = 'Original approved plan: interview three qualified CFO candidates on Thursday — Avery 9 a.m. Central, Morgan 10 a.m., Jordan 11 a.m.';
  const row = (approver: string) =>
    `| 1 | **Original plan:** interview three qualified CFO candidates on Thursday. Avery at 9 a.m., Morgan at 10 a.m. and Jordan at 11 a.m. Central, one hour each, with the same panel and no overlaps. Client update due Thursday at noon Central, after all interviews. | Approved plan | Avery's and Morgan's slots stand. | ${approver} |`;

  it('reads no approver in "Original approved plan"', () => {
    expect(approversNamed(fact)).toEqual([]);
    expect(rolesNamed(fact)).toEqual([]);
    expect(approversNamed('Revised approved budget: $44,000. Signed approved contract on file. Latest authorized headcount is 12.')).toEqual([]);
  });

  it('raises nothing against a log that says the approver is not recorded, or not specified', () => {
    for (const approver of ['Approved; approver not recorded', 'Approved; approver not specified', 'Approver: not specified']) {
      expect(missedApprovals(row(approver), [fact])).toEqual([]);
      expect(approverFindings(row(approver), [fact])).toEqual([]);
    }
  });

  it('still reads a person who approved something', () => {
    expect(approversNamed('Elena approved the budget. Priya approved changing the launch date. Marco has approved budget changes.')).toEqual(['Elena', 'Priya', 'Marco']);
    expect(approversNamed('Dana approved it on 2 November. Omar authorized $5,000.')).toEqual(['Dana', 'Omar']);
  });

  it('reads "approver not specified" as an approver called unknown, so a recorded approval is still caught', () => {
    const facts = ['The board authorized management to schedule a process-improvement analysis this quarter.'];
    expect(missedApprovals('Decision: schedule the process-improvement analysis. Approver not specified.', facts)).toHaveLength(1);
  });

  it('never takes the word after "Approver:" for a person when it is not a name', () => {
    expect(approversNamed('Approver: unknown')).toEqual([]);
    expect(approversNamed('Approver: unspecified')).toEqual([]);
    expect(approversNamed('Approver: pending')).toEqual([]);
    expect(approversNamed('Approver: TBD. Approver: Unknown. Approver - Pending')).toEqual([]);
    expect(approversNamed('Approver: Priya')).toEqual(['Priya']);
  });
});
