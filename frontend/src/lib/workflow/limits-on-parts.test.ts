import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { measureStageContent, projectRequirements, stageRequirements } from './context';
import { listedAmongParts, parseRequirements } from './measurable';
import type { WorkflowTemplate } from './types';
import type { ProjectFact } from '@/types/project';

/**
 * Sean, 27 Nov, Cedar Street Bridge (L-319): "Keep the newsletter under 70 words" was
 * held against the release checklist (243, then 247 words) through five repairs, even
 * after he told Go the limit was the blurb's. The brief, the stages and the texts are
 * his project's, as saved.
 */
const fx = (name: string) => readFileSync(`src/lib/workflow/__fixtures__/${name}`, 'utf8');
const template = JSON.parse(fx('cedar-template.json')) as WorkflowTemplate;
const brief = JSON.parse(fx('cedar-brief.json')) as { objective: string; constraints: string; output_format: string };
const DRAFTS = fx('cedar-drafts-v2.md');
const CHECKLIST = fx('cedar-release-checklist-v14.md');
const stage = (id: string) => template.stages.find((s) => s.id === id)!;
const project = (facts: ProjectFact[] = []) => ({ ...brief, facts });

describe("a limit on one part is that part's (L-319)", () => {
  it('reads "newsletter" as one of the listed drafts, not the whole deliverable', () => {
    expect(listedAmongParts('newsletter', brief.objective)).toBe(true);
    expect(listedAmongParts('essay', 'The essay must be exactly 2,137 words, not one more, not one less.')).toBe(false);
    const reqs = projectRequirements(project()).filter((r) => r.kind === 'words');
    expect(reqs.map((r) => [r.subject, r.max])).toEqual([['newsletter blurb', 70]]);
  });

  it('measures it on the drafts, under the blurb\'s heading, and never on the checklist', () => {
    const onDrafts = measureStageContent(project(), template, stage('draft_the_three_items'), DRAFTS);
    expect(onDrafts.map((m) => [m.label, m.satisfied])).toEqual([[expect.stringMatching(/^Newsletter blurb: at most 70 words/i), true]]);
    expect(stageRequirements(project(), template, stage('release_checklist')).filter((r) => r.requirement.kind === 'words')).toEqual([]);
    expect(measureStageContent(project(), template, stage('release_checklist'), CHECKLIST)).toEqual([]);
  });

  it("reads Sean's answer naming the blurb, and keeps no whole-deliverable limit beside it", () => {
    const answer = {
      id: 'a1', kind: 'fact', subject: null, retired_at: null, supersedes: null, created_at: '2026-11-27T00:43:00Z',
      statement: 'Decided by the user — asked "Which draft does the 70-word limit apply to?", answered: The 70-word limit applies only to the newsletter blurb.',
    } as unknown as ProjectFact;
    const reqs = projectRequirements({ ...brief, constraints: brief.constraints.replace('Keep the newsletter under 70 words.', 'Keep it under 70 words.'), facts: [answer] }).filter((r) => r.kind === 'words');
    expect(reqs.every((r) => r.subject !== '')).toBe(true);
    expect(reqs.some((r) => r.subject.includes('newsletter'))).toBe(true);
  });
});

describe('a part named before its bracket (27 Nov, Alder Quay)', () => {
  it('"Executive update (maximum 95 words)" is the update\'s, and the same limit unnamed elsewhere is not the whole', () => {
    const reqs = parseRequirements([
      'Create four labeled sections: Executive update (maximum 95 words), Session plan, Attendance and Risks.',
      'Executive update maximum 95 words.',
    ]).filter((r) => r.kind === 'words');
    expect(reqs.map((r) => [r.subject, r.max])).toEqual([['executive update', 95]]);
  });

  it('a limit said to be the total stays the whole\'s', () => {
    const reqs = parseRequirements(['Executive update (maximum 95 words). Keep it under 95 words in total.']).filter((r) => r.kind === 'words');
    expect(reqs.map((r) => r.subject).sort()).toEqual(['', 'executive update']);
  });
});

describe('a stop that says what Go could not establish (L-319)', () => {
  it('asks which part when a whole-text limit is missed by double or more', async () => {
    const { wholeLimitMayBeAPart } = await import('@/lib/agent/perform');
    expect(wholeLimitMayBeAPart(['The deliverable: at most 70 words — measured 247 words'])).toBe(true);
    expect(wholeLimitMayBeAPart(['The deliverable: at most 600 words — measured 640 words'])).toBe(false);
    expect(wholeLimitMayBeAPart(['Newsletter blurb: at most 70 words — measured 247 words'])).toBe(false);
  });
});
