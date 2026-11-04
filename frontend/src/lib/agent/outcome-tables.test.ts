/**
 * 4 Nov (Sean): "In Research, the narrative and evidence table disagreed about
 * what had been reproduced." The deliverable check is given the outcome tables
 * before the write-up, each row with its status as the table names it.
 */
import { describe, expect, it } from 'vitest';

import { outcomeTablesBefore } from './deliverable-check';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';
import { itemSchemaFor, serializeItems } from '@/lib/workflow/stage-artifact';
import { effectiveRenderer } from '@/lib/workflow/stage-artifact';
import { isTriageTable } from '@/lib/workflow/triage';
import type { StageArtifactBundle } from '@/lib/workflow/digest';

const outcome = RESEARCH_V1.stages.find((s) => (effectiveRenderer(s) === 'list' || effectiveRenderer(s) === 'review') && (itemSchemaFor(s).statuses?.length ?? 0) > 0 && !isTriageTable(itemSchemaFor(s)))!;
const last = RESEARCH_V1.stages.at(-1)!;

describe('the outcome tables a write-up reports on', () => {
  it('Research has one, before its write-up', () => {
    expect(outcome).toBeTruthy();
    expect(RESEARCH_V1.stages.indexOf(outcome)).toBeLessThan(RESEARCH_V1.stages.indexOf(last));
  });

  it('sends each row with its status, and leaves findings tables out', () => {
    const schema = itemSchemaFor(outcome);
    const [first, second] = schema.statuses!;
    const field = schema.fields[0].key;
    const bundles = {
      [outcome.id]: { versions: [{ id: 'v1', content: serializeItems([
        { id: 'r1', [field]: 'Effect of dose on recovery', status: first.value },
        { id: 'r2', [field]: 'Baseline rate', status: second.value },
      ]) }] },
    } as unknown as Record<string, StageArtifactBundle>;
    const [table] = outcomeTablesBefore(RESEARCH_V1, bundles, last.id);
    expect(table.label).toBe(outcome.short_label || outcome.label);
    expect(table.rows).toContain(`- r1: Effect of dose on recovery — status: ${first.label}`);
    expect(table.rows).toContain(`- r2: Baseline rate — status: ${second.label}`);
    // Nothing on record, nothing sent.
    expect(outcomeTablesBefore(RESEARCH_V1, {}, last.id)).toEqual([]);
  });
});
