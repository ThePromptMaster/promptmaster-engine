/**
 * The curated business examples, as the landing page and the start screen list
 * them (the client's call, 4 Nov: "a restaurant with no menu"). Kept apart from
 * the sample material so those pages do not carry it.
 *
 * What each one says is in the dictionaries (`ex.<key>.*`); what it holds is in
 * `index.ts`.
 */
export const EXAMPLE_CARDS = [
  { key: 'investment_memo', slug: 'investment-memo', icon: 'request_quote' },
  { key: 'business_analysis', slug: 'business-analysis', icon: 'query_stats' },
] as const;

export type ExampleKey = (typeof EXAMPLE_CARDS)[number]['key'];

export function exampleHref(slug: string): string {
  return `/examples/${slug}`;
}

/**
 * The version an example starts with. No model wrote it, so nothing downstream
 * may treat it as a model's work, and reading figures from it is not a reason
 * to spend anything: pressing Continue on it costs nothing.
 */
export const PREPARED_OPERATION = 'example_prewritten';
