/**
 * Whether a new version only takes text out of the old one (20 Nov). Pure.
 *
 * Sean, warehouse rerun: "Go stopped to ask whether it should remove an internal
 * editing note from the final package … routine cleanup Go should handle when it
 * has permission to make routine edits." Under "Handle them for me" Go makes one
 * such pass past its edit limit on a stage, and this is what holds it to taking
 * text out: every line it keeps was in the old version, word for word, and at
 * least one line went.
 */
export function onlyRemoves(before: string, after: string): boolean {
  const lines = (text: string) => text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const had = lines(before);
  const kept = lines(after);
  if (!kept.length || kept.length >= had.length) return false;
  // In order, as a subsequence: nothing moved, nothing reworded.
  let i = 0;
  for (const line of kept) {
    while (i < had.length && had[i] !== line) i += 1;
    if (i === had.length) return false;
    i += 1;
  }
  return true;
}
