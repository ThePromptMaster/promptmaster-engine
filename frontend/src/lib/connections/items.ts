import type { ThirdPartyItem } from '@/types';

/**
 * Something read from the user's own account, in the browser. It goes nowhere until
 * they tick it and press Send, and then it travels as a `ThirdPartyItem`: other
 * people's words, never the user's (`project_context.third_party_block`).
 */
export interface ConnectedItem {
  id: string;
  kind: ThirdPartyItem['kind'];
  /** Who it came from: an organiser, a sender, a service. */
  source: string;
  title: string;
  /** The text that will be sent if it is ticked, exactly as shown. */
  text: string;
  /** For a calendar entry, when it starts. For sorting and the briefing's title. */
  startsAt?: string;
}

/** What crosses the network: exactly what the preview showed, and nothing else on the item. */
export function toThirdParty(items: readonly ConnectedItem[]): ThirdPartyItem[] {
  return items.map(({ kind, source, title, text }) => ({ kind, source, title, text }));
}

/** The server takes twenty at a time (`SuggestWorkflowsRequest`). */
export const MAX_TICKED = 20;
