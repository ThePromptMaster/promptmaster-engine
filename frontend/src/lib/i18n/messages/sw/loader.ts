import type { en } from '../areas/loader';

/** Swahili for `areas/loader.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const sw: Record<keyof typeof en, string> = {
  'proj.saving': 'Inahifadhi…',
  'proj.saved': 'Imehifadhiwa',
  'proj.conflict': 'Imebadilishwa mahali pengine',
  'proj.notSaved': 'Haijahifadhiwa',
  'proj.retryNow': 'Jaribu tena sasa',
  'proj.titleLabel': 'Jina la mradi',
  'proj.backToProjects': 'Rudi kwenye miradi',
  'proj.projects': 'Miradi',
  'proj.stale': 'Mabadiliko ya karibuni hayakuweza kupakiwa, kwa hiyo ukurasa huu huenda umepitwa na wakati. Hakuna kilichopotea.',
  'proj.reload': 'Pakia upya',
  'proj.otherTab': 'Mradi huu ulibadilishwa kwenye kichupo kingine.',
  'proj.reloadTheirs': 'Pakia upya toleo lile',
  'proj.keepMine': 'Baki na mabadiliko yangu',
  'proj.noWorkflow': 'Imeshindwa kupakia mtiririko wa kazi wa mradi huu.',
  'proj.noWorkflowHint': 'Hakuna kilichopotea — hili ni tatizo la kupakia, si mradi uliopotea.',
  'proj.retry': 'Jaribu tena',
  'proj.retrying': 'Inajaribu tena…',
  'proj.noStages': 'Mtiririko wa kazi wa mradi huu haukuweza kupakiwa, kwa hiyo hatua zake hazipatikani. Toleo la karibuni la kazi yake liko hapa chini.',
  'proj.nothingYet': 'Bado hakuna kilichozalishwa katika mradi huu.',
  'proj.noHistory': 'Imeshindwa kupakia hali ya mradi huu.',
  'proj.noHistoryHint': 'Historia yake haikupakiwa, kwa hiyo hatua zake haziwezi kuonyeshwa bado. Hakuna kilichopotea: kazi yako na maendeleo ya kila hatua yamehifadhiwa.',
};
