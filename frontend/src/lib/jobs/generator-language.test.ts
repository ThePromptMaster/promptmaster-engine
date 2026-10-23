import { describe, expect, it } from 'vitest';
import { languageHeaderFor } from './generator';

describe('a background chapter is written in the project language (client, 21 Oct)', () => {
  it('sends the language saved with the job', () => {
    expect(languageHeaderFor({ inputs: { language: 'es' } })).toEqual({ 'X-PromptMaster-Language': 'es' });
  });

  it('sends nothing for English, an old job or an unknown code', () => {
    expect(languageHeaderFor({ inputs: { language: 'en' } })).toEqual({});
    expect(languageHeaderFor({ inputs: {} })).toEqual({});
    expect(languageHeaderFor({ inputs: { language: 'xx' } })).toEqual({});
    expect(languageHeaderFor(null)).toEqual({});
  });
});
