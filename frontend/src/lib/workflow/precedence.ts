/**
 * What wins when two instructions pull against each other. Pure.
 *
 * Mirrors backend/promptmaster/precedence.py, which states the order in every
 * prompt; `precedence-drift.test.ts` keeps the two equal. Here it only
 * recommends an answer in the conflict prompt (PM-24): the user is still the
 * one who chooses.
 */

import type { Controls, InstructionConflict } from './instruction-conflicts';

/** Highest first. */
export const PRECEDENCE = ['objective', 'decision', 'instruction', 'stage', 'constraint', 'mode', 'generated'] as const;
export type PrecedenceKey = (typeof PRECEDENCE)[number];

const rank = (key: PrecedenceKey) => PRECEDENCE.indexOf(key);

/**
 * Which side the order favours when the user's new instruction conflicts with
 * something: what ranks above an instruction is kept, what ranks below it
 * gives way, and two instructions are the user's to weigh.
 */
export function recommendedControl(kind: InstructionConflict['kind']): Controls | null {
  const theirs = rank(kind);
  const mine = rank('instruction');
  return theirs < mine ? 'existing' : theirs > mine ? 'new' : null;
}
