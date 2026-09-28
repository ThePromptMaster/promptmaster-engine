import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { parseItems } from './stage-artifact';
import { generationContent } from './stage-requests';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const empty = { content: '', items: [], finish_reason: 'stop', model_used: 'm' } as never;

describe('generationContent', () => {
  it('stores an empty open-items table as a valid draft, not as "came back empty"', () => {
    const content = generationContent(stage('final_review'), empty);
    expect(parseItems(content)).toEqual([]);
  });
  it('still treats an empty findings table as unusable', () => {
    expect(generationContent(stage('critique'), empty)).toBe('');
  });
});
