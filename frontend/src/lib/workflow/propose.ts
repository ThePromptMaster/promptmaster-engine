/**
 * Proposed statuses for a check table already drafted (3 Oct, Research run).
 *
 * A table drafted before proposals existed — or a row the draft could not
 * settle — still reads "Not looked at" over text that already says what was
 * found. One model call reads each undecided row and proposes the status its
 * own text supports, with the reason; the rows stay undecided until the user
 * confirms (`confirmProposals`). Used by the button above the table and by
 * Go's `propose_statuses` move.
 */

import { api } from '@/lib/api/client';
import type { AgentStateDigest } from '@/lib/agent/digest';
import type { Project } from '@/types/project';
import type { StageItem, StageItemSchema } from './stage-artifact';
import { applyProposals, proposalStatuses, proposeTargets } from './proposals';
import { inputsFrom } from './stage-requests';

/** One model call: proposals for the target rows. Nothing is saved. */
export async function proposeStatuses(args: {
  project: Project;
  items: StageItem[];
  schema: StageItemSchema;
  state?: AgentStateDigest;
  signal?: AbortSignal;
}): Promise<{ items: StageItem[]; applied: string[]; model_used: string }> {
  const targets = proposeTargets(args.items, args.schema);
  if (!targets.length) return { items: args.items, applied: [], model_used: '' };
  const res = await api.agentTriage(
    {
      inputs: inputsFrom(args.project),
      state: args.state ?? ({} as AgentStateDigest),
      items: targets.map((i) => Object.fromEntries(Object.entries(i).filter(([k, v]) => k !== 'status' && k !== 'reason' && k !== 'status_source' && typeof v === 'string')) as Record<string, string>),
      statuses: proposalStatuses(args.schema).map((s) => ({ value: s.value, label: s.label, requires_reason: Boolean(s.requiresReason) })),
      model: args.project.model,
      mode: 'propose',
    },
    args.signal
  );
  return { ...applyProposals(args.items, res.decisions, args.schema), model_used: res.model_used };
}
