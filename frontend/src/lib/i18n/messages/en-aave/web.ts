import type { en } from '../areas/web';

/** African American English for `areas/web.ts` (Sean, 26 Oct). */
export const aave: Record<keyof typeof en, string> = {
  "web.label": "Web access and sources",
  "web.title": "Web sources",
  "web.on": "web access on",
  "web.off": "web access off",
  "web.saved": " · {count} saved",
  "web.switch": "Web access",
  "web.explain": "— when it's on, PromptMaster can search the public web for this project, from here or in Go. Every search get saved as sources with their links and the date, stages cite them as [S1], [S2], …, and every search cost a little extra. Off keep the project to what you give it.",
  "web.form": "Search the web",
  "web.queryHint": "What to look up, like Harbor Industrial Services revenue 2025",
  "web.queryLabel": "What to search the web for",
  "web.searching": "Searching…",
  "web.search": "Search the web",
  "web.list": "Saved sources",
  "web.retrieved": "pulled up {date}",
  "web.byGo": " by Go",
  "web.searched": " · searched “{query}”",
  "web.takeOut": "Take out",
  "web.none": "Ain't no sources saved yet.",
  "web.newSaved_one": "{count} new source saved",
  "web.newSaved_other": "{count} new sources saved",
  "web.alreadyOnRecord": "; {count} already on record",
  "web.noResults": "The search ain't bring back no sources. Nothing got saved.",
  "web.failed": "The search ain't work. Nothing got saved.",
  "web.saveError": "That ain't save.",
};
