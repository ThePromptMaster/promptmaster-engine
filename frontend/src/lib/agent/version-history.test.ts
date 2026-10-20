import { describe, expect, it } from 'vitest';
import { knownVersions, referencedVersions } from './version-history';
import { serializeItems } from '@/lib/workflow/stage-artifact';
import type { StageArtifactBundle } from '@/lib/workflow/digest';

const template = {
  stages: [
    { id: 'screening_analysis', label: 'Screening analysis', short_label: 'Analysis' },
    { id: 'evidence_and_consistency_check', label: 'Evidence and consistency check', short_label: 'Check' },
    { id: 'screening_package', label: 'Screening package', short_label: 'Package' },
  ],
} as never;

const version = (n: number, content: string) => ({ id: `v${n}`, version_number: n, content }) as never;
const check = (n: number) =>
  version(n, serializeItems([
    { id: 'f4', finding: `Use one rounding convention (round ${n}).`, status: 'accepted', reason: '' },
    { id: 'f5', finding: 'Label option (a) and option (b).', status: 'rejected', reason: 'Already labelled.' },
  ]));
const bundles: Record<string, StageArtifactBundle> = {
  evidence_and_consistency_check: { artifact: null, versions: Array.from({ length: 22 }, (_, i) => check(i + 1)) },
  screening_analysis: { artifact: null, versions: [version(7, 'Analysis seven text.'), version(8, '§6 rates the first conclusion High.'), version(9, 'Latest.')] },
};

describe('knownVersions', () => {
  it('names each stage with saved versions under both labels, with the count', () => {
    expect(knownVersions(template, bundles)).toEqual({ Check: 22, 'Evidence and consistency check': 22, Analysis: 9, 'Screening analysis': 9 });
  });
});

describe('referencedVersions (19 Oct, HARBOR: "Check v18 is not in the project")', () => {
  it('gives the cited earlier versions: a table as its rows with their decisions, prose as its text', () => {
    const out = referencedVersions(template, bundles, 'Apply Check v18 f4 as accepted; Analysis v8 §6 rates it High.');
    expect(out[0]).toContain('Check v18 f4: [accepted] Use one rounding convention (round 18).');
    expect(out[0]).toContain('Check v18 f5: [rejected] Label option (a) and option (b). — reason: Already labelled.');
    expect(out[1]).toBe('Analysis v8:\n§6 rates the first conclusion High.');
  });

  it('leaves out the latest version, which the check already reads, and versions that do not exist', () => {
    expect(referencedVersions(template, bundles, 'Check v22 and Check v40 and Analysis v9')).toEqual([]);
  });
});
