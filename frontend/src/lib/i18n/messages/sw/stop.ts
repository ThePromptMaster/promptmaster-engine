import type { en } from '../areas/stop';

/** Swahili for `areas/stop.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const sw: Record<keyof typeof en, string> = {
  'stop.cleared': 'Tayari kuendelea — bonyeza Endelea tena.',
  'stop.movedOn': 'Mradi umepita hatua hiyo — bonyeza Endelea tena ili uendelee kuanzia hapa.',
  'stop.waitingApproval': 'Inasubiri idhini yako: {action}.',
  'stop.windowClosed': 'Dirisha limefungwa ili kusasisha kazi iliyoathirika.',
  'stop.plannedFor': 'Hatua hiyo ilipangwa kwa {was}; sasa mradi uko kwenye {now}. Bonyeza Go ili kupanga upya.',
  'stop.stageChanged': 'Hatua ilibadilika baada ya kitendo hicho kupangwa, kwa hiyo hakikutekelezwa. Bonyeza Go ili kupanga upya.',
  'stop.declined': 'Umekataa "{action}".',
  'stop.byYou': 'Imesimamishwa na wewe.',
  'stop.suggestedAgain': 'Imependekezwa tena baada ya hatua kubadilika.',
  'stop.beforeBudget': 'Imesimama kabla ya "{action}": inahitaji hatua {n} na zimebaki {m}.',
  'stop.goError': 'Hali ya Go imekumbana na hitilafu.',
  'stop.finished': 'Mradi umekamilika.',
  'stop.noObjective': 'Mradi bado hauna lengo. Weka lengo, kisha bonyeza Go.',
  'stop.stuck': 'Hatua hii imewekwa alama kuwa imekwama: {why}. Ondoa alama hiyo, au iruke, ili Go iendelee.',
  'stop.budgetUsed': 'Imetumia hatua zote {n} za bajeti ya mzunguko huu.',
  'stop.failedInRow': 'Hatua {n} za mwisho zimeshindwa. Inasimama badala ya kujaribu tena bila mwelekeo.',
  'stop.alternating': 'Inazunguka pale pale: "{a}" na "{b}" zimekuwa zikipokezana kwenye hatua hii bila kusonga mbele. Inahitaji mwelekeo wako.',
  'stop.repairedTooOften': 'Inazunguka pale pale: {stage} ilirekebishwa mara {n} katika mzunguko huu, na kila toleo jipya lilifungua kazi tena. Kila marekebisho yamehifadhiwa kama toleo lake; angalia la karibuni kabla Go haijaendelea. Inahitaji mwelekeo wako.',
  'stop.noProgressNone': 'Inazunguka pale pale: "{action}" ilichaguliwa mara {n} mfululizo kwa hatua ileile, na hakuna hata mara moja iliyohifadhi chochote. Kila kilichozalishwa kimo kwenye kumbukumbu ya mzunguko.',
  'stop.noProgressSome': 'Inazunguka pale pale: "{action}" ilichaguliwa mara {n} mfululizo kwa hatua ileile, na ni {saved} tu kati yake zilizohifadhi toleo jipya. Kila kilichozalishwa kimo kwenye kumbukumbu ya mzunguko.',
  'stop.noChange': 'Vitendo {n} vya mwisho havikubadilisha chochote kwenye hatua hii — hakuna toleo jipya, hakuna uamuzi uliorekodiwa, hakuna hitaji lililotimizwa. Niambie nifanye nini tofauti, au fanya sehemu inayofuata mwenyewe kisha bonyeza Endelea tena.',
  'stop.roundsIdle': 'Go imefanya mizunguko {n} tangu kitu kipya kifike kwenye mradi, kwa hiyo haianzishi mzunguko mwingine: inaendelea hadi {stage}. Kilichobaki wazi kinasonga mbele kama vipengele vilivyo wazi na mapungufu.',
  'stop.aDecision': 'uamuzi kutoka kwako',
  'stop.resumeCheck': 'endeleza Go ili ikague lengo tena',
};
