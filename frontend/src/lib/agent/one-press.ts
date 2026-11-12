/**
 * One press at a time (12 Nov, production). A choice pressed twice recorded the
 * answer twice and started a second loop on the same run: the first loop's step
 * was closed as "Interrupted", its own close-out was then refused by the
 * database ("agent step … is finished and cannot change"), and the run ended
 * failed. A press that arrives while one is still in hand is dropped. Pure.
 */
export interface OnePress {
  /** Whether a press is in hand now. */
  readonly busy: boolean;
  /** Does the work unless a press is already in hand; resolves to whether it was done. */
  run(work: () => Promise<void>): Promise<boolean>;
}

export function onePress(): OnePress {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(work) {
      if (busy) return false;
      busy = true;
      try {
        await work();
        return true;
      } finally {
        busy = false;
      }
    },
  };
}

/**
 * Whether a run found in the database is the one this tab's own loop is
 * driving right now. Its steps in flight are alive, not left behind by a tab
 * that went away, so they are never closed as interrupted.
 */
export function drivingHere(found: { id: string }, mine: { id: string } | null, loopActive: boolean): boolean {
  return loopActive && mine?.id === found.id;
}
