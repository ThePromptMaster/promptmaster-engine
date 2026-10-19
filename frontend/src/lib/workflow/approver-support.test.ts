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
    expect(finding.suggested_change).toContain('approver not recorded');
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
