/**
 * Look the named sources up, then read each found one's abstract and judge it
 * (5 Oct: "Go should default to doing every verification step it legitimately
 * can itself before asking the user"). One function for the stage's button and
 * for Go, so both say the same thing and set the same statuses.
 */

import { api } from '@/lib/api/client';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { Project } from '@/types/project';
import {
  applyLookup,
  applySavedSources,
  applyVerification,
  lookupQueries,
  lookupSummary,
  verifyQueries,
  verifySummary,
  type LookupResult,
  type VerifyResult,
} from './lookup';
import type { StageItem, StageItemSchema } from './stage-artifact';

export interface LookupAndVerify {
  items: StageItem[];
  lookup: LookupResult;
  verify: VerifyResult | null;
  message: string;
}

export async function lookupAndVerify(
  project: Project,
  items: StageItem[],
  schema: StageItemSchema,
  signal?: AbortSignal
): Promise<LookupAndVerify | null> {
  const works = lookupQueries(items, schema);
  if (!works.length) return null;
  const { matches } = await api.agentLiterature(works, signal);
  const indexed = applyLookup(items, matches, schema);
  // What the index did not hold may be a work a web search already found and saved (25 Oct).
  const web = applySavedSources(indexed.items, project.sources ?? [], schema);
  const looked: LookupResult = { ...indexed, items: web.items };
  const toRead = verifyQueries(looked.items, schema);
  let verify: VerifyResult | null = null;
  if (toRead.length) {
    const { verdicts } = await api.agentVerifySources({ inputs: inputsFrom(project), sources: toRead, model: project.model }, signal);
    verify = applyVerification(looked.items, verdicts, schema);
  }
  const found = lookupSummary(looked, schema.lookup!.noun, schema.lookup!.notFoundNote).replace(' Review, then save.', '');
  const read = verify ? verifySummary(verify) : '';
  return {
    items: verify?.items ?? looked.items,
    lookup: looked,
    verify,
    message: [
      found.replace(/ A found record means[^.]*\./, ''),
      web.found ? `${web.found} more found in a saved web source.` : '',
      read || (looked.found ? 'A found record means the work exists, not that it says what the row claims.' : '')].filter(Boolean).join(' '),
  };
}
