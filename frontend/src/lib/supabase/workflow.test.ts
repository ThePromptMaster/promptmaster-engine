import { describe, expect, it } from 'vitest';

import { definitionOf, latestPerKey, toTemplate } from './workflow';
import { templateFromDesign, type DesignedWorkflow } from '@/lib/workflow/custom';

describe('latestPerKey', () => {
  it('keeps only the newest version of each template, whatever order rows arrive in', () => {
    const rows = [
      { id: 'book-1', key: 'book', version: 1 },
      { id: 'book-2', key: 'book', version: 2 },
      { id: 'research-2', key: 'research', version: 2 },
      { id: 'research-1', key: 'research', version: 1 },
      { id: 'single-1', key: 'single_output', version: 1 },
    ];

    expect(latestPerKey(rows).map((r) => r.id)).toEqual(['book-2', 'research-2', 'single-1']);
  });

  it('is empty for no rows', () => {
    expect(latestPerKey([])).toEqual([]);
  });
});

describe('a designed workflow, saved and read back', () => {
  const design: DesignedWorkflow = {
    name: 'Supplier review',
    description: 'One review, checked.',
    deliverable: 'review',
    inquiry: true,
    execution: {
      kind: 'finite',
      success_criterion: 'Every supplier has a verdict that quotes its terms.',
      stop_conditions: ['A supplier refuses to share terms.'],
    },
    stages: [
      { label: 'Brief', short_label: 'Brief', kind: 'write', purpose: 'Say what is reviewed.', instruction: 'State the brief.', required: true, approval: '' },
      { label: 'Review', short_label: 'Review', kind: 'write', purpose: 'Write it.', instruction: 'Write the review.', required: true, approval: '' },
    ],
  };

  it('keeps what Go reads: the success criterion, the nouns and the moves it may make', () => {
    const template = templateFromDesign(design, 'abc123');
    const back = toTemplate({
      id: 'row-1',
      key: template.key,
      version: template.version,
      name: template.name,
      description: template.description,
      definition: definitionOf(template),
    });

    expect(back.execution).toEqual(design.execution);
    expect(back.nouns).toEqual(template.nouns);
    expect(back.inquiry).toBe(true);
    expect(back.stages).toEqual(template.stages);
  });

  it('adds nothing to a workflow that sets no criterion', () => {
    const { execution: _none, ...plain } = design;
    void _none;
    const definition = definitionOf(templateFromDesign(plain, 'abc123'));
    expect(definition).not.toHaveProperty('execution');
  });
});
