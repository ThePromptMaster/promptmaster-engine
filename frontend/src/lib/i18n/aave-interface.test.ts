import { describe, expect, it } from 'vitest';

import { localeDirection, localeFromCookie, resolveLocale } from './locales';
import { translate } from './translate';
import { stageText } from './templates';
import { startLanguage } from '@/lib/workflow/languages';
import { QUICK_V1 } from '@/lib/workflow/templates/quick.v1';

/**
 * Sean, 26 Oct: African American English "for everything in promptmaster just
 * as if it was a change in language, even for the instructions".
 */
describe('African American English as an interface language', () => {
  it('is chosen by its own code, not folded into English', () => {
    expect(resolveLocale('en-aave')).toBe('en-aave');
    expect(resolveLocale('EN-AAVE')).toBe('en-aave');
    expect(localeFromCookie('en-aave')).toBe('en-aave');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(localeDirection('en-aave')).toBe('ltr');
  });

  it('reads the interface and the stage instructions in AAE', () => {
    expect(translate('en-aave', 'quick.takeFullFailed', { reason: 'x' })).not.toBe(translate('en', 'quick.takeFullFailed', { reason: 'x' }));
    const stage = QUICK_V1.stages[0];
    expect(stageText('en-aave', 'quick', stage, 'guidance')).not.toBe(stage.entry_guidance);
    // Plurals use English rules.
    expect(translate('en-aave', 'acct.computations', { count: 1 })).toContain('1');
  });

  it('a new project read in AAE writes in AAE', () => {
    expect(startLanguage('en-aave')).toBe('en-aave');
  });
});
