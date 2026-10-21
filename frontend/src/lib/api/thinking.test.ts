import { afterEach, describe, expect, it } from 'vitest';

import { THINKING_HEADER, setRequestThinking, thinkingHeaders } from './thinking';

afterEach(() => setRequestThinking('standard'));

describe('the project thinking level travels as one header (14 Oct call)', () => {
  it('sends Deep and nothing at Standard, the backend default', () => {
    expect(thinkingHeaders()).toEqual({});
    setRequestThinking('deep');
    expect(thinkingHeaders()).toEqual({ [THINKING_HEADER]: 'deep' });
    setRequestThinking(undefined);
    expect(thinkingHeaders()).toEqual({});
  });
});
