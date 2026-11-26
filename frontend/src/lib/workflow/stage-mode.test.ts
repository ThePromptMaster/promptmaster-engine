import { describe, expect, it } from 'vitest';

import { choosesPerStep, modeForStage, thinkingFor } from './stage-mode';

const critic = { recommended_modes: [{ mode: 'critic' as const, reason: 'It checks the draft' }] };
const none = { recommended_modes: [] };

describe('how PromptMaster thinks on a stage (26 Nov, Sean: "or have PromptMaster whatever it thinks best")', () => {
  it('when PromptMaster chooses, a stage is worked in its own mode, with why', () => {
    const project = { mode: 'architect' as const, stage_modes: 'stage' as const };
    expect(thinkingFor(project, critic)).toEqual({ mode: 'critic', source: 'step', reason: 'It checks the draft' });
    expect(thinkingFor(project, none)).toEqual({ mode: 'architect', source: 'default' });
    expect(choosesPerStep(project)).toBe(true);
  });

  it('a stage_modes left unset reads as PromptMaster choosing, as the column\'s default', () => {
    expect(thinkingFor({ mode: 'clarity' }, critic).source).toBe('step');
    expect(choosesPerStep({ mode: 'clarity' })).toBe(true);
  });

  it('one way of thinking picked by the user is used on every step', () => {
    const project = { mode: 'analyst' as const, stage_modes: 'project' as const };
    expect(thinkingFor(project, critic)).toEqual({ mode: 'analyst', source: 'yours' });
    expect(thinkingFor(project, none)).toEqual({ mode: 'analyst', source: 'yours' });
    expect(choosesPerStep(project)).toBe(false);
  });

  it('the user\'s own persona is never replaced', () => {
    expect(thinkingFor({ mode: 'custom', stage_modes: 'stage' }, critic)).toEqual({ mode: 'custom', source: 'custom' });
  });

  it('modeForStage answers as it did before', () => {
    expect(modeForStage({ mode: 'architect', stage_modes: 'stage' }, critic)).toBe('critic');
    expect(modeForStage({ mode: 'architect', stage_modes: 'project' }, critic)).toBe('architect');
    expect(modeForStage({ mode: 'architect' }, null)).toBe('architect');
  });
});
