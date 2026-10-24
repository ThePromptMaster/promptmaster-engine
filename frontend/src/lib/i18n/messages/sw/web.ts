import type { en } from '../areas/web';

/** Swahili for `areas/web.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const sw: Record<keyof typeof en, string> = {
  'web.label': 'Ufikiaji wa wavuti na vyanzo',
  'web.title': 'Vyanzo vya wavuti',
  'web.on': 'ufikiaji wa wavuti umewashwa',
  'web.off': 'ufikiaji wa wavuti umezimwa',
  'web.saved': ' · {count} vimehifadhiwa',
  'web.switch': 'Ufikiaji wa wavuti',
  'web.explain': '— ukiwashwa, PromptMaster inaweza kutafuta kwenye wavuti ya umma kwa ajili ya mradi huu, kutoka hapa au katika Go. Kila utafutaji unahifadhiwa kama vyanzo pamoja na viungo vyake na tarehe, hatua zinavinukuu kama [S1], [S2], …, na kila utafutaji unagharimu kidogo zaidi. Ukizimwa, mradi unabaki na kile unachotoa wewe tu.',
  'web.form': 'Tafuta kwenye wavuti',
  'web.queryHint': 'Cha kutafuta, mf. mapato ya Harbor Industrial Services 2025',
  'web.queryLabel': 'Utafute nini kwenye wavuti',
  'web.searching': 'Inatafuta…',
  'web.search': 'Tafuta kwenye wavuti',
  'web.list': 'Vyanzo vilivyohifadhiwa',
  'web.retrieved': 'kilipatikana {date}',
  'web.byGo': ' na Go',
  'web.searched': ' · ilitafutwa “{query}”',
  'web.takeOut': 'Ondoa',
  'web.none': 'Bado hakuna vyanzo vilivyohifadhiwa.',
  'web.newSaved_one': 'chanzo {count} kipya kimehifadhiwa',
  'web.newSaved_other': 'vyanzo {count} vipya vimehifadhiwa',
  'web.alreadyOnRecord': '; {count} tayari vimo kwenye kumbukumbu',
  'web.noResults': 'Utafutaji haukuleta vyanzo vyovyote. Hakuna kilichohifadhiwa.',
  'web.failed': 'Utafutaji umeshindwa. Hakuna kilichohifadhiwa.',
  'web.saveError': 'Hilo halikuhifadhiwa.',
};
