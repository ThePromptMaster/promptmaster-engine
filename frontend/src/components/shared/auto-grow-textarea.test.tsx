import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { AutoGrowTextarea } from './auto-grow-textarea';

describe('AutoGrowTextarea (13 Oct)', () => {
  it('gives the caller the element, so text typed before the page was interactive can be read back', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<AutoGrowTextarea ref={ref} value="" onChange={() => undefined} aria-label="Goal" />);
    expect(ref.current?.tagName).toBe('TEXTAREA');
  });
});
