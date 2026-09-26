import type { Iteration, ModeType } from '@/types';

/**
 * The original core's endpoints (chat, apply, flow triggers, continue
 * document) take an `Iteration` — the 5-phase flow's unit of work. A stage
 * version is the same idea: some text, a number, a mode. Adapting it here is
 * what lets the workspace reuse those endpoints, their prompt builders and
 * their tests without a backend change (PM-10).
 */
export function asIteration(output: string, number: number, mode: ModeType): Iteration {
  return {
    iteration_number: number,
    prompt_sent: '',
    system_prompt_used: '',
    output,
    mode,
    evaluation: null,
  };
}
