import type { en } from '../areas/header';

/** Swahili for `areas/header.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const sw: Record<keyof typeof en, string> = {
  'stageHead.complete': 'Imekamilika',
  'stageHead.stuck': 'Imekwama',
  'stageHead.skipped': 'Imerukwa',
  'stageHead.stale': 'Inasubiri ukaguzi upya',
  'stageHead.leftOpen': 'Imeachwa wazi',
  'stageHead.reopened': 'Imefunguliwa tena',
  'stageHead.draftApproval': 'Rasimu imekamilika · Idhini yako inasubiriwa',
  'stageHead.approval': 'Idhini yako inasubiriwa',
  'stageHead.approvalWhy': 'PromptMaster imethibitisha kile inachoweza. Hatua hii inabaki wazi hadi utoe idhini kwenye orodha ya ukaguzi hapa chini.',
  'stageHead.position': 'Hatua {index} kati ya {total}',
  'stageHead.optional': 'si lazima',
  'stageHead.skippedWhy': 'Imerukwa — {reason}',
  'stageHead.hideGuidance': 'Ficha mwongozo',
  'stageHead.pickMode': 'Jinsi ya kufikiri kuhusu hatua hii — chagua hali',
  'stageHead.suited': 'Inafaa hatua hii',
  'stageHead.inUse': 'Inatumika',
};
