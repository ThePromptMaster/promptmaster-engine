/**
 * What the start conversation hands the setup recommendation and the workflow
 * designer (20 Nov). Pure.
 *
 * Sean, warehouse rerun: his brief said "If the facts make the plan impossible,
 * explain the shortfall and identify the decision needed." The conversation's own
 * reply added "The package will flag that as a decision for you", and the whole
 * transcript, PromptMaster's turns included, went to the setup labelled as
 * material the user attached. The project's constraints came back ending "must
 * flag the zero-slack risk as a decision for the user", and every stage obeyed a
 * requirement he never wrote. The setup now reads what the user said, the outline
 * they shaped, and the requirements the brief holds (which are only what they said
 * or plainly agreed to) — never PromptMaster's replies.
 */

export interface BriefForSetup {
  objective: string;
  audience: string;
  requirements: string[];
  deliverables: string[];
  stages: string[];
  approvals: string[];
}

export function conversationMaterial(
  brief: BriefForSetup,
  /** The user's own turns, and what they typed into the outline. */
  said: string
): { objective: string; audience: string; material: string } {
  const lines = [
    brief.audience && `Audience: ${brief.audience}`,
    brief.deliverables.length && `Deliverables: ${brief.deliverables.join('; ')}`,
    brief.stages.length && `Stages discussed: ${brief.stages.join(' › ')}`,
    brief.approvals.length && `Approvals wanted: ${brief.approvals.join('; ')}`,
    brief.requirements.length && `Requirements the user stated or agreed: ${brief.requirements.join('; ')}`,
  ].filter(Boolean);
  return {
    objective: brief.objective,
    audience: brief.audience,
    material: [lines.join('\n'), said.trim() && `What the user said:\n${said.trim()}`].filter(Boolean).join('\n\n'),
  };
}
