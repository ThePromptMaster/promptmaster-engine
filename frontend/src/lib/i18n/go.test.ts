import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ACTIONS as ACTIONS, actionLabel } from '@/lib/agent/actions';
import { POLICY_TERMS } from '@/lib/agent/authorize';
import { en } from './messages/en';
import { shownActionLabel } from './go';
import { setLocale } from './store';

/** Go's names and terms as shown match the English the planner and the authorization record keep. */
describe('Go in the interface language (client, 21 Oct)', () => {
  afterEach(() => setLocale('en'));

  it('names every registered move, in English exactly as the registry does', () => {
    for (const a of ACTIONS) expect(shownActionLabel(a.key), a.key).toBe(actionLabel(a.key));
  });

  it('shows the recorded policy terms one for one', () => {
    const dict = en as Record<string, string>;
    for (const [policy, terms] of Object.entries(POLICY_TERMS)) {
      terms.forEach((term, i) => expect(dict[`gt.term.${policy}.${i}`], `${policy}.${i}`).toBe(term));
      expect(dict[`gt.term.${policy}.${terms.length}`]).toBeUndefined();
    }
  });

  it('names a move in Spanish', () => {
    setLocale('es');
    expect(shownActionLabel('advance_stage')).toBe('Pasar a la siguiente etapa');
  });
});
