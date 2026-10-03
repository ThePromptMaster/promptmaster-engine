import { describe, expect, it } from 'vitest';

import { BOOK_V1, projectState } from './index';
import { buildChatContext, chatContentFor, outlineLines } from './chat-context';
import type { StageArtifactBundle } from './digest';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { OutlineSection } from '@/types';

const PROJECT = { objective: 'Write a book about lions.', audience: 'Curious adults' } as Pick<Project, 'objective' | 'audience' | 'data_files'>;

const section = (title: string, abstract: string, content: string): OutlineSection =>
  ({ id: title, title, abstract, status: content ? 'complete' : 'pending', content, revision: 1, finish_reason: null, error: null, generated_at: null }) as OutlineSection;

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const drafting = BOOK_V1.stages.find((s) => s.renderer === 'long_form')!;
const outlineStage = BOOK_V1.stages.find((s) => s.renderer === 'outline')!;

const bundles: Record<string, StageArtifactBundle> = {
  [drafting.id]: {
    artifact: {
      id: 'd',
      long_form: {
        outline: [
          section('The pride', 'How lions live together', 'Lions live in prides of up to thirty.'),
          section('The hunt', 'Who hunts and why', 'Lionesses do most of the hunting.'),
        ],
      },
    } as unknown as Artifact,
    versions: [],
  },
};

const state = projectState(BOOK_V1, []);

describe('the side chat sees the project (3 Oct call)', () => {
  it('reads an outline stage as titles and abstracts, not blank rows', () => {
    const json = JSON.stringify({ items: [{ id: 'a', title: 'The pride', abstract: 'How lions live together' }] });
    expect(chatContentFor(BOOK_V1, outlineStage, {}, json)).toBe('1. The pride — How lions live together');
  });

  it('reads a chapter stage as the chapters themselves', () => {
    const text = chatContentFor(BOOK_V1, drafting, bundles, '');
    expect(text).toContain('## 1. The pride');
    expect(text).toContain('Lionesses do most of the hunting.');
  });

  it('gives a review stage the outline and the chapters, so it never asks for them', () => {
    const ctx = buildChatContext({ template: BOOK_V1, state, project: PROJECT, stage: stage('continuity'), bundles, controls: null });
    expect(ctx.stage_label).toBe(stage('continuity').label);
    expect(ctx.workflow_stages).toContain(stage('continuity').label);
    expect(ctx.outline).toContain('2. The hunt — Who hunts and why');
    expect(ctx.manuscript).toContain('Lions live in prides of up to thirty.');
    expect(ctx.buttons).toBeNull();
  });

  it('does not send the chapters twice on a chapter stage', () => {
    const ctx = buildChatContext({ template: BOOK_V1, state, project: PROJECT, stage: drafting, bundles, controls: [] });
    expect(ctx.manuscript).toBe('');
    expect(ctx.buttons).toEqual([]);
  });

  it('names the page buttons in their own words and place', () => {
    const ctx = buildChatContext({
      template: BOOK_V1, state, project: PROJECT, stage: stage('continuity'), bundles,
      controls: [{ id: 'draft', label: 'Draft this stage', place: 'stage_bar' }],
    });
    expect(ctx.buttons).toEqual([{ label: 'Draft this stage', where: 'the main button at the bottom of the stage' }]);
  });

  it('falls back to the Outline stage when nothing is drafted yet', () => {
    const json = JSON.stringify({ items: [{ id: 'a', title: 'Habitat', abstract: 'Where lions live' }] });
    const ctx = buildChatContext({
      template: BOOK_V1, state, project: PROJECT, stage: stage('outline_approval'),
      bundles: { [outlineStage.id]: { artifact: { id: 'o' } as Artifact, versions: [{ id: 'v', content: json } as ArtifactVersion] } },
      controls: null,
    });
    expect(ctx.outline).toBe('1. Habitat — Where lions live');
  });

  it('skips empty outline rows', () => {
    expect(outlineLines([{ title: '', abstract: '' }, { title: 'A' }])).toBe('1. A');
  });
});
