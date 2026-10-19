'use client';

import { useSyncExternalStore } from 'react';

/**
 * Simple or advanced (Sean, 18 Oct, email 7 — a new beta user found the start
 * "overwhelming": too many questions and too much to read, and he would learn
 * the advanced features once comfortable with the basics).
 *
 * Simple is the default for everyone: one box, a few questions at most, a
 * one-screen summary with Start, and the detail folded away. Advanced is the
 * full setup as it was. The choice is kept in this browser only — it is a
 * preference about the screen, not project state.
 */
export type Experience = 'simple' | 'advanced';

export const EXPERIENCE_STORAGE_KEY = 'pm.experience.v1';

/** "Ask me a few questions" in the simple start stops after this many. */
export const SIMPLE_GUIDE_QUESTIONS = 3;

export function readExperience(): Experience {
  try {
    return localStorage.getItem(EXPERIENCE_STORAGE_KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    // Private windows throw on storage access; the simple start is the safe default.
    return 'simple';
  }
}

const listeners = new Set<() => void>();

export function writeExperience(value: Experience) {
  try {
    if (value === 'advanced') localStorage.setItem(EXPERIENCE_STORAGE_KEY, 'advanced');
    else localStorage.removeItem(EXPERIENCE_STORAGE_KEY);
  } catch {
    // Not kept; the page still switches for this visit.
  }
  memory = value;
  listeners.forEach((l) => l());
}

/** What this visit chose when storage would not keep it. */
let memory: Experience | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === EXPERIENCE_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The current choice, read through useSyncExternalStore so the server and hydrating renders agree. */
export function useExperience(): [Experience, (value: Experience) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const stored = readExperience();
      return stored === 'simple' && memory === 'advanced' ? 'advanced' : stored;
    },
    () => 'simple' as Experience
  );
  return [value, writeExperience];
}
