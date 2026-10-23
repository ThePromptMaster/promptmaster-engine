import { describe, expect, it } from 'vitest';
import { BOOK_V1, SINGLE_OUTPUT_V1 } from '@/lib/workflow';
import { QUOTE_MAX, readingSections, sideChatQuote, stageReadingText } from './reading';
import type { StageArtifactBundle } from './digest';
import type { Artifact, ArtifactVersion } from '@/types/project';

const stage = (template: typeof BOOK_V1, id: string) => template.stages.find((s) => s.id === id)!;
const bundle = (artifact: Partial<Artifact>, content?: string): StageArtifactBundle => ({
  artifact: artifact as Artifact,
  versions: content === undefined ? [] : [{ id: 'v', content } as ArtifactVersion],
});

describe('reading another project (client feedback, 21 Oct, email 4)', () => {
  it("reads a prose stage's head version", () => {
    const text = stageReadingText(SINGLE_OUTPUT_V1, stage(SINGLE_OUTPUT_V1, 'output'), { output: bundle({ stage_id: 'output' }, '# Memo\n\nThe answer.') });
    expect(text).toBe('# Memo\n\nThe answer.');
  });

  it("reads a later long-form stage's chapters from the drafting manuscript", () => {
    const outline = [
      { id: 's1', title: 'Beginnings', abstract: '', status: 'complete', content: 'It started.' },
      { id: 's2', title: 'Later', abstract: '', status: 'pending', content: '' },
    ];
    const bundles = { drafting: bundle({ stage_id: 'drafting', long_form: { outline } as never }) };
    const text = stageReadingText(BOOK_V1, stage(BOOK_V1, 'drafting'), bundles);
    expect(text).toContain('## 1. Beginnings');
    expect(text).toContain('It started.');
  });

  it('says nothing for a stage with nothing written', () => {
    expect(stageReadingText(SINGLE_OUTPUT_V1, stage(SINGLE_OUTPUT_V1, 'output'), {})).toBe('');
  });

  it('cuts the text at its headings', () => {
    expect(readingSections('Intro line\n\n## One\n\nFirst.\n\n### Two\nSecond.')).toEqual([
      { heading: '', body: 'Intro line' },
      { heading: 'One', body: 'First.' },
      { heading: 'Two', body: 'Second.' },
    ]);
  });

  it('quotes a section into the chat with where it came from, at most QUOTE_MAX', () => {
    const quote = sideChatQuote('Harbor study', 'Findings', { heading: 'Costs', body: 'Line one\n\nLine two' });
    expect(quote).toBe('> **Costs**\n>\n> Line one\n>\n> Line two\n\nFrom "Harbor study" — Findings\n\n');
    const long = sideChatQuote('X', 'Y', { heading: '', body: 'a'.repeat(QUOTE_MAX + 500) });
    expect(long).toContain('[…]');
    expect(long.length).toBeLessThan(QUOTE_MAX + 60);
  });
});
