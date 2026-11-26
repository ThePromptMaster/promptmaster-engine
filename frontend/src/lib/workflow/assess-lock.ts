/**
 * Who is judging an Assess stage's paste right now, and how far it has got (L-284).
 *
 * 22 Nov, Sean: "it won't finish assessing". The page had saved the first twelve
 * and was judging the other nine; the screen said they were "not judged yet"
 * beside a greyed button, so it looked stuck. It finished 50 seconds later.
 *
 * One judge at a time, the page or Go, so the same items are never judged twice
 * and neither save is refused for the other's. The run's progress lives here,
 * not in the stage's renderer, so leaving the stage and coming back still shows
 * it. In memory for this tab: a run in another tab still meets the save guard.
 */

import { useSyncExternalStore } from 'react';

export type AssessJudge = 'page' | 'go';

export interface AssessRun {
  by: AssessJudge;
  /** Rows this run has added so far. */
  judged: number;
  /** Items the last call said were still to judge; null before the first call answers. */
  left: number | null;
  startedAt: number;
}

const runs = new Map<string, AssessRun>();
const stops = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assessKey(projectId: string, stageId: string): string {
  return `${projectId}:${stageId}`;
}

/** Takes the stage for one judge; false when the other (or another run) holds it. */
export function claimAssess(key: string, by: AssessJudge, controller?: AbortController, now = Date.now()): boolean {
  if (runs.has(key)) return false;
  runs.set(key, { by, judged: 0, left: null, startedAt: now });
  if (controller) stops.set(key, controller);
  emit();
  return true;
}

export function reportAssess(key: string, by: AssessJudge, judged: number, left: number | null): void {
  const run = runs.get(key);
  if (!run || run.by !== by) return;
  runs.set(key, { ...run, judged, left });
  emit();
}

export function releaseAssess(key: string, by: AssessJudge): void {
  if (runs.get(key)?.by !== by) return;
  runs.delete(key);
  stops.delete(key);
  emit();
}

/** Stops the page's run: what it saved stays, the rest is kept to assess. False when there is none to stop. */
export function stopAssess(key: string): boolean {
  const controller = stops.get(key);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function assessRunFor(key: string): AssessRun | null {
  return runs.get(key) ?? null;
}

/** Resolves once nobody is judging the stage, or when `signal` is aborted. */
export function whenAssessFree(key: string, signal?: AbortSignal): Promise<void> {
  if (!runs.has(key) || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (runs.has(key) && !signal?.aborted) return;
      unsubscribe();
      signal?.removeEventListener('abort', check);
      resolve();
    };
    const unsubscribe = subscribe(check);
    signal?.addEventListener('abort', check);
  });
}

/** The run on a stage as the page shows it; re-renders as it moves. */
export function useAssessRun(key: string | null | undefined): AssessRun | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? runs.get(key) ?? null : null),
    () => null
  );
}
