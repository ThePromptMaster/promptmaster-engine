import { describe, expect, it } from 'vitest';

import { designDepth, isConcise, outgrowsOneStage, sizeKey, listsSeveralDeliverables, oneStageFor } from './request-size';

describe('what each way in does with the request’s size (11 Nov)', () => {
  it('a concise request is served by one stage, whichever button', () => {
    expect(isConcise({ depth: 'concise' })).toBe(true);
    expect(isConcise({ depth: 'standard' })).toBe(false);
    expect(isConcise(null)).toBe(false);
  });
  it('a first draft of a larger request is taken toward the full process, but never on a size that could not be read', () => {
    expect(outgrowsOneStage({ depth: 'full', reason: '', by: 'rule' })).toBe(true);
    expect(outgrowsOneStage({ depth: 'standard', reason: '', by: 'model' })).toBe(true);
    expect(outgrowsOneStage({ depth: 'concise', reason: '', by: 'model' })).toBe(false);
    expect(outgrowsOneStage({ depth: 'standard', reason: '', by: 'default' })).toBe(false);
    expect(outgrowsOneStage(null)).toBe(false);
  });
  it('the designer is told standard or full, and a concise request is not designed', () => {
    expect(designDepth({ depth: 'full', by: 'rule' })).toBe('full');
    expect(designDepth({ depth: 'standard', by: 'model' })).toBe('standard');
    expect(designDepth({ depth: 'concise', by: 'model' })).toBeUndefined();
    // Could not be read: the designer is told nothing and designs as before.
    expect(designDepth({ depth: 'standard', by: 'default' })).toBeUndefined();
    expect(designDepth(undefined)).toBeUndefined();
  });
  it('a changed objective is sized again', () => {
    expect(sizeKey('p1', 'A short email')).toBe(sizeKey('p1', 'A short email'));
    expect(sizeKey('p1', 'A short email')).not.toBe(sizeKey('p1', 'A book about lions'));
    expect(sizeKey('p1', 'A short email')).not.toBe(sizeKey('p2', 'A short email'));
  });
});

describe('a brief of several deliverables is not one stage (19 Nov)', () => {
  const material = 'Audience: operations director\nDeliverables: An executive recommendation; A training schedule; A staff announcement under 150 words\n\nThe conversation:\n…';
  it('reads the brief line the conversation adds', () => {
    expect(listsSeveralDeliverables(material)).toBe(true);
    expect(listsSeveralDeliverables('Deliverables: A 120-word reminder')).toBe(false);
    expect(listsSeveralDeliverables('The conversation:\nno brief')).toBe(false);
  });
  it('a concise size serves one stage only for one piece', () => {
    expect(oneStageFor({ depth: 'concise' }, material)).toBe(false);
    expect(oneStageFor({ depth: 'concise' }, 'Deliverables: A 120-word reminder')).toBe(true);
    expect(oneStageFor({ depth: 'standard' }, '')).toBe(false);
  });
});
