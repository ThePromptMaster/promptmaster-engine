/**
 * Results called calculated or verified without the evidence, found in code.
 * Pure.
 *
 * 25 Oct (Sean): "It sometimes describes something as verified or completed
 * even though no actual computation, source verification, or required
 * calculation was performed." The stage prompts already ask for the five
 * words (reasoned, calculated, externally verified, conditional, speculative);
 * this is the check that the two strong ones have something behind them:
 *
 *   calculated, computed, reproduced → a code run that exited cleanly in this
 *                                      project, or the sentence names one
 *   verified, confirmed              → the sentence cites a saved source [S#],
 *                                      a reference [R#], a DOI or link, an
 *                                      OpenAlex record, or the user
 *
 * Only a claim is read: a label ("Calculated —", "(verified)") or a statement
 * that something was done ("was computed", "we verified"). A sentence that
 * negates or defers it ("not yet calculated", "to be verified", "once
 * computed") is not a claim. Deliberately narrow (L-118): a miss leaves the
 * prompt rule as the only guard; a false alarm costs a needless repair.
 */

export interface RunEvidence {
  /** Sandbox runs in this project that exited cleanly. */
  codeRuns: number;
}

export interface UnsupportedClaim {
  /** The sentence, trimmed for a line. */
  quote: string;
  /** The word that makes the claim, as written. */
  word: string;
  needs: 'run' | 'source';
}

const RUN_WORDS = 'calculated|computed|reproduced|simulated';
const SOURCE_WORDS = 'externally verified|verified|confirmed';
const ALL = `${SOURCE_WORDS}|${RUN_WORDS}`;

/** "Calculated —", "**Verified:**", "(computed)", "| Calculated |", "Status: verified". */
const LABEL = new RegExp(`(?:^|[\\s(\\[|*_:])(${ALL})(?:[*_]{0,2})\\s*(?=[—–:)\\]|]|-\\s)`, 'i');
/** "was computed", "have been verified", "we confirmed", "numerically verified" — never "is calculated as", which defines a method. */
const STATED = new RegExp(
  `\\b(?:was|were|been|we|I|PromptMaster|Go|numerically|computationally|independently|explicitly)\\s+(?:(?:now|then|also|already|independently|numerically|explicitly|directly|successfully)\\s+)?(${ALL})\\b`,
  'i'
);
/** Any of these in the sentence and it is not a claim that the thing was done. */
const NOT_A_CLAIM =
  /\b(?:not|no|never|cannot|can't|isn't|wasn't|weren't|hasn't|haven't|hadn't|without|unverified|uncalculated|yet|would|could|should|will|must|might|may|need|needs|needed|pending|planned|plan|proposed?|next|if|once|until|unless|whether|before|reasoned|conditional|speculative|to be)\b/i;
/** The sentence cites where its verification came from. */
const CITES = /\[(?:S|R)\d+\]|\bdoi(?:\.org)?[:/]|\bhttps?:\/\/|\bOpenAlex\b|\b(?:you|the user|the client)\s+(?:confirmed|verified|supplied|provided)\b|\bconfirmed by (?:you|the user|the client)\b|\bsupplied (?:data|file|material)\b/i;
/** The sentence names the run its figure came from. */
const NAMES_RUN = /\b(?:sandbox|run [0-9a-f]{8}|ran (?:the )?code|code run)\b/i;
/** A verification done by computing is a calculation claim. */
const BY_COMPUTING = /\b(?:numerically|computationally|by (?:the )?code|in (?:the )?sandbox|by running)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z*_(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function quoteOf(s: string, max = 160): string {
  const plain = s.replace(/[*_`#>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function unsupportedClaims(text: string, evidence: RunEvidence): UnsupportedClaim[] {
  const out: UnsupportedClaim[] = [];
  for (const s of sentences(text)) {
    const m = LABEL.exec(s) ?? STATED.exec(s);
    if (!m) continue;
    if (NOT_A_CLAIM.test(s.replace(m[0], ' '))) continue;
    const word = m[1];
    const needs: UnsupportedClaim['needs'] = new RegExp(`^(?:${RUN_WORDS})$`, 'i').test(word) || BY_COMPUTING.test(s) ? 'run' : 'source';
    const backed = needs === 'run' ? evidence.codeRuns > 0 || NAMES_RUN.test(s) : CITES.test(s);
    if (!backed) out.push({ quote: quoteOf(s), word: word.toLowerCase(), needs });
  }
  return out;
}

/** As a measured requirement's detail: what is wrong and what fixes it. */
export function describeUnsupported(claims: readonly UnsupportedClaim[]): string {
  const runs = claims.filter((c) => c.needs === 'run');
  const sources = claims.filter((c) => c.needs === 'source');
  const parts = [
    runs.length ? `${runs.length} called ${runs[0].word} with no code run in this project (${runs.slice(0, 2).map((c) => `"${c.quote}"`).join('; ')})` : '',
    sources.length ? `${sources.length} called ${sources[0].word} with no source cited (${sources.slice(0, 2).map((c) => `"${c.quote}"`).join('; ')})` : '',
  ].filter(Boolean);
  return `${parts.join('; ')} — call each reasoned, conditional or speculative instead, or cite what backs it`;
}
