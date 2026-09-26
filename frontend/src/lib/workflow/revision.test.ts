import { describe, expect, it } from 'vitest';

import { BOOK_V1, RESEARCH_V1 } from './index';
import type { StageArtifactBundle } from './digest';
import { formatRevisionNotes, revisionBrief } from './revision';
import { serializeItems } from './stage-artifact';
import type { Artifact, ArtifactVersion } from '@/types/project';

function rows(items: Record<string, string>[]): StageArtifactBundle {
  return {
    artifact: { id: 'a' } as Artifact,
    versions: [{ id: 'v', content: serializeItems(items.map((r, i) => ({ id: `i${i}`, ...r }))) } as ArtifactVersion],
  };
}

const bundles: Record<string, StageArtifactBundle> = {
  continuity: rows([
    { finding: 'The term "control" is used two ways', where: 'Ch 1 and Ch 3', severity: 'high', status: 'accepted' },
    { finding: 'Chapter 2 repeats chapter 1', where: 'Ch 2', severity: 'low', status: 'rejected', reason: 'Deliberate' },
    { finding: 'Untriaged', where: 'Ch 3', severity: 'low' },
  ]),
  critique: rows([
    { finding: 'No worked example', why_it_matters: 'Readers cannot apply it', suggested_change: 'Add one', status: 'accepted' },
  ]),
  fact_check: rows([
    { claim: '90% of audits fail', source: 'none', where: 'Ch 1', status: 'removed', reason: 'No source exists' },
    { claim: 'IIA Standards exist', source: 'theiia.org', where: 'Ch 2', status: 'verified' },
  ]),
};

describe('revisionBrief', () => {
  it('gives Revision the findings accepted in Continuity, and only those', () => {
    const brief = revisionBrief(BOOK_V1, 'revision', bundles)!;
    expect(brief.sources).toEqual(['Continuity review or controlled expansion']);
    expect(brief.findings.map((f) => f.text)).toEqual([
      'The term "control" is used two ways — Ch 1 and Ch 3 — high',
    ]);
    // A rejected finding is the user deciding not to change the text.
    expect(formatRevisionNotes(brief.findings)).not.toContain('repeats chapter 1');
    expect(brief.instruction).toMatch(/accepted findings/);
  });

  it('gives Editing what Critique accepted and the claims Fact-check marked for removal', () => {
    const brief = revisionBrief(BOOK_V1, 'editing', bundles)!;
    const notes = formatRevisionNotes(brief.findings);
    expect(notes).toContain('No worked example');
    expect(notes).toContain('90% of audits fail');
    expect(notes).toContain('[removed: No source exists]');
    expect(notes).not.toContain('IIA Standards exist');
  });

  it('is null for the stage that drafts the manuscript, and for non-long-form stages', () => {
    expect(revisionBrief(BOOK_V1, 'drafting', bundles)).toBeNull();
    expect(revisionBrief(BOOK_V1, 'critique', bundles)).toBeNull();
  });

  it('works on Research with no workflow-specific handling', () => {
    const brief = revisionBrief(RESEARCH_V1, 'revision', {});
    expect(brief).not.toBeNull();
    expect(brief!.findings).toEqual([]);
  });
});
