import { describe, expect, it } from 'vitest';

import { approverFindings, approversNamed, unsupportedApprovers } from './approver-support';

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
