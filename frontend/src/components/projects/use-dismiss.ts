'use client';

import { useEffect, useRef } from 'react';

/**
 * Closes a popover on a press outside it or on Escape. `pointerdown`, not
 * `mousedown`: an iPhone sends no mousedown for a tap on something that is not
 * clickable, so a popover opened by mistake stayed over the list (Sean, 24 Oct).
 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return ref;
}
