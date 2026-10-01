import { describe, expect, it } from 'vitest';

import { deliverableNouns, isSaved, operationLabel } from './labels';
import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';

describe('isSaved (C6)', () => {
  it('keeps what the user chose and hides what the app produced on the way', () => {
    for (const op of ['stage_edit', 'applied_findings', 'applied_recommendations', 'chat_instruct', 'chat_save', 'restore', 'long_form_complete', 'manuscript_snapshot', 'outline_edit'])
      expect(isSaved(op), op).toBe(true);
    for (const op of ['stage_draft', 'stage_regenerate', 'refine', 'flow_refine_shorter', 'continuation', 'agent_draft', 'agent_revise', 'agent_outline', 'agent_triage', null, undefined])
      expect(isSaved(op), String(op)).toBe(false);
  });
  it('every saved operation has a label of its own', () => {
    for (const op of ['stage_edit', 'applied_findings', 'long_form_complete']) expect(operationLabel(op)).not.toMatch(/_/);
  });
});

describe('deliverableNouns (1 Oct, item 26)', () => {
  it('a workflow that drafts in sections is not thereby a book', () => {
    expect(deliverableNouns(BOOK_V1)).toEqual({ deliverable: 'book', unit: 'chapter' });
    expect(deliverableNouns(RESEARCH_V1)).toEqual({ deliverable: 'research report', unit: 'section' });
    expect(deliverableNouns(SINGLE_OUTPUT_V1)).toEqual({ deliverable: 'work', unit: 'section' });
  });
  it('a template that names its own nouns is taken at its word', () => {
    expect(deliverableNouns({ ...RESEARCH_V1, nouns: { deliverable: 'diagnosis', unit: 'finding' } })).toEqual({ deliverable: 'diagnosis', unit: 'finding' });
  });
});
