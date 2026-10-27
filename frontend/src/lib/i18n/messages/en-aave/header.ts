import type { en } from '../areas/header';

/** African American English for `areas/header.ts` (Sean, 26 Oct). */
export const aave: Record<keyof typeof en, string> = {
  "stageHead.complete": "Done",
  "stageHead.stuck": "Stuck",
  "stageHead.skipped": "Skipped",
  "stageHead.stale": "Waiting on a recheck",
  "stageHead.leftOpen": "Left open",
  "stageHead.reopened": "Opened back up",
  "stageHead.draftApproval": "Draft done · Waiting on your approval",
  "stageHead.approval": "Waiting on your approval",
  "stageHead.approvalWhy": "PromptMaster done checked what it can. This stage gon' stay open till you give your approval in the checklist below.",
  "stageHead.position": "Stage {index} of {total}",
  "stageHead.optional": "optional",
  "stageHead.skippedWhy": "Skipped — {reason}",
  "stageHead.hideGuidance": "Hide the guidance",
  "stageHead.pickMode": "How to think 'bout this stage — pick a mode",
  "stageHead.suited": "Good fit for this stage",
  "stageHead.inUse": "In use",
};
