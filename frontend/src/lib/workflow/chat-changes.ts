/**
 * What changed on the page since the side chat last answered. Pure.
 *
 * 31 Oct (Sean): "The run status moved from 'running' to 'blocked' to
 * 'awaiting_decision'. A 'Continue writing' button appeared and then
 * disappeared. The chat assistant gave me wrong version numbers and
 * contradictory button advice as a result." The chat was told the page as it
 * was at each message, but nothing told it that what it had said before no
 * longer held. The workspace keeps what it last sent, per stage, and each
 * message carries the difference.
 */

import type { ChatContext } from '@/types';

/** The parts of the page a reply can be wrong about once they change. */
export interface PageSnapshot {
  stageStatus: string;
  goStatus: string | null;
  buttons: string[];
  /** The newest version's number; null when the stage has none. */
  latest: number | null;
  /** The version on screen. */
  shown: number | null;
  /** Versions the length limit cut off. */
  cutOff: number[];
}

export function pageSnapshot(ctx: Pick<ChatContext, 'stage_status' | 'go_run' | 'buttons' | 'versions'>): PageSnapshot {
  const versions = ctx.versions ?? [];
  return {
    stageStatus: ctx.stage_status ?? '',
    goStatus: ctx.go_run?.status ?? null,
    buttons: (ctx.buttons ?? []).map((b) => b.label),
    latest: versions.at(-1)?.number ?? null,
    shown: versions.find((v) => v.shown)?.number ?? null,
    cutOff: versions.filter((v) => v.cut_off).map((v) => v.number),
  };
}

const GO_WORDS: Record<string, string> = {
  running: 'running',
  awaiting_decision: 'waiting for your decision',
  blocked: 'stopped, blocked',
  completed: 'finished',
  budget_exhausted: 'stopped at the end of its window of steps',
  stopped: 'stopped by you',
  failed: 'stopped on an error',
};
const goWords = (s: string | null) => (s ? GO_WORDS[s] ?? s.replace(/_/g, ' ') : 'no run');
const quoted = (labels: readonly string[]) => labels.map((l) => `"${l}"`).join(', ');

/** Each change, as a line the chat is given; [] when nothing it could have said is out of date. */
export function pageChanges(before: PageSnapshot | null | undefined, now: PageSnapshot): string[] {
  if (!before) return [];
  const out: string[] = [];
  if (before.goStatus !== now.goStatus) out.push(`Go: ${goWords(before.goStatus)} → ${goWords(now.goStatus)}`);
  if (before.stageStatus !== now.stageStatus && now.stageStatus) out.push(`This stage: ${before.stageStatus || 'no status'} → ${now.stageStatus}`);
  if (now.latest !== null && before.latest !== now.latest) {
    out.push(before.latest === null ? `v${now.latest} saved` : `New version saved: v${now.latest} (was v${before.latest})`);
  }
  if (now.shown !== null && before.shown !== now.shown) out.push(`The user is now looking at v${now.shown}`);
  const fixed = before.cutOff.filter((n) => now.latest === n && !now.cutOff.includes(n));
  if (fixed.length) out.push(`v${fixed.join(', v')} is no longer cut off`);
  const gone = before.buttons.filter((b) => !now.buttons.includes(b));
  const added = now.buttons.filter((b) => !before.buttons.includes(b));
  if (gone.length) out.push(`No longer on the page: ${quoted(gone)}`);
  if (added.length) out.push(`Now on the page: ${quoted(added)}`);
  return out.slice(0, 12);
}

/** Who made a version, in the words the chat uses. */
export function madeBy(operation: string | null | undefined): 'user' | 'go' | 'chat' | 'system' {
  const op = operation ?? '';
  if (op === 'stage_edit' || op === 'restore' || op === 'outline_edit') return 'user';
  if (op.startsWith('agent_')) return 'go';
  if (op.startsWith('chat_')) return 'chat';
  return 'system';
}
