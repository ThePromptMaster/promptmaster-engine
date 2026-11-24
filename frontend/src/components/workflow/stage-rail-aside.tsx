'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

/** Per-viewer conveniences only: whether this person last pulled the stages in, and how wide they dragged them. */
const RAIL_OPEN_KEY = 'pm.stageRailOpen';
const RAIL_WIDTH_KEY = 'pm.stageRailWidth';
export const RAIL_WIDTH = { min: 200, max: 400, initial: 248, step: 16, collapsed: 60 } as const;

/** The stages' width, from what was stored or dragged. Anything unreadable is the default. */
export function clampRailWidth(value: unknown): number {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return RAIL_WIDTH.initial;
  return Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, n)));
}

/** Open unless this person pulled it in last time. */
export function initialRailOpen(remembered: string | null): boolean {
  return remembered !== '0';
}

// The two choices live in localStorage, an external store: read through
// useSyncExternalStore so the server and hydrating renders agree (as
// `beta-notice.tsx` does). Where storage is unavailable (a private window,
// blocked site data) this tab's own choice is still kept, in memory.
const kept = new Map<string, string>();
const listeners = new Set<() => void>();
function readStored(key: string): string | null {
  if (kept.has(key)) return kept.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  kept.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembering past this tab is fine; the choice still holds here.
  }
  listeners.forEach((l) => l());
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
const useStored = (key: string) => useSyncExternalStore(subscribe, () => readStored(key), () => null);

/** For tests: forget this tab's choices. */
export function forgetRailChoices() {
  kept.clear();
}

interface Props {
  /** The workflow's name and progress, shown above the stages while they are out. */
  header: ReactNode;
  /** The stage rail, full or as a strip of icons. */
  rail: (compact: boolean) => ReactNode;
}

/**
 * The stages beside the work on a computer or tablet, with a handle to drag
 * them wider or narrower and a button to pull them in to a strip of icons and
 * back (24 Nov, Sean: "a moving thingy to shorten the stage side like the side
 * chat has one where you can expand and retract"). The phone's stage drawer is
 * unchanged. The page header's gutter follows the width through `--pm-rail-w`.
 */
export function StageRailAside({ header, rail }: Props) {
  const t = useT();
  const open = initialRailOpen(useStored(RAIL_OPEN_KEY));
  const storedWidth = clampRailWidth(useStored(RAIL_WIDTH_KEY));
  // While a drag is under way its width is shown but not yet kept.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = dragWidth !== null;
  const width = dragWidth ?? storedWidth;

  const shown = open ? width : RAIL_WIDTH.collapsed;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--pm-rail-w', `${shown}px`);
    return () => {
      root.style.removeProperty('--pm-rail-w');
    };
  }, [shown]);

  const setOpen = useCallback((value: boolean) => writeStored(RAIL_OPEN_KEY, value ? '1' : '0'), []);
  const keepWidth = useCallback((next: number) => writeStored(RAIL_WIDTH_KEY, String(clampRailWidth(next))), []);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      // The stages sit at the start of the row: on the left, or on the right in a right-to-left page.
      const rtl = document.documentElement.dir === 'rtl';
      let last = startWidth;
      setDragWidth(startWidth);
      const move = (ev: PointerEvent) => {
        last = startWidth + (rtl ? startX - ev.clientX : ev.clientX - startX);
        setDragWidth(clampRailWidth(last));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        keepWidth(last);
        setDragWidth(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [width, keepWidth]
  );

  const toggle =
    'shrink-0 rounded-lg p-1.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)] hover:text-[var(--on-surface)]';

  return (
    <div
      data-stage-rail={open ? 'open' : 'collapsed'}
      style={{ width: shown }}
      className={`sticky top-0 hidden h-screen shrink-0 md:block ${dragging ? '' : 'transition-[width] duration-200'}`}
    >
      <aside id="stage-rail" className="h-full overflow-y-auto bg-[var(--surface-container-lowest)] px-2 pb-24 pt-6 sidebar-scroll">
        {open ? (
          <>
            <div className="mb-5 flex items-start gap-1 ps-3">
              <div className="min-w-0 flex-1">{header}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-expanded
                aria-controls="stage-rail"
                aria-label={t('ws.hideStages')}
                title={t('ws.hideStages')}
                className={`-mt-1 ${toggle}`}
              >
                <span aria-hidden className="material-symbols-outlined rtl:-scale-x-100 text-[20px]">
                  left_panel_close
                </span>
              </button>
            </div>
            {rail(false)}
          </>
        ) : (
          <>
            <div className="mb-4 flex justify-center">
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-expanded={false}
                aria-controls="stage-rail"
                aria-label={t('ws.showStages')}
                title={t('ws.showStages')}
                className={toggle}
              >
                <span aria-hidden className="material-symbols-outlined rtl:-scale-x-100 text-[20px]">
                  left_panel_open
                </span>
              </button>
            </div>
            {rail(true)}
          </>
        )}
      </aside>

      {/* Drag to widen the stages or the work; arrows do the same from the keyboard. */}
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ws.resizeStages')}
          aria-valuemin={RAIL_WIDTH.min}
          aria-valuemax={RAIL_WIDTH.max}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            const rtl = document.documentElement.dir === 'rtl';
            const wider = rtl ? 'ArrowLeft' : 'ArrowRight';
            const narrower = rtl ? 'ArrowRight' : 'ArrowLeft';
            if (e.key === wider) keepWidth(width + RAIL_WIDTH.step);
            else if (e.key === narrower) keepWidth(width - RAIL_WIDTH.step);
            else return;
            e.preventDefault();
          }}
          className="group absolute inset-y-6 end-0 z-10 flex w-3 translate-x-1/2 cursor-col-resize items-center justify-center rtl:-translate-x-1/2"
        >
          <span className="h-10 w-1 rounded-full bg-[var(--surface-container-highest)] group-hover:bg-[var(--pm-primary)] group-focus-visible:bg-[var(--pm-primary)]" />
        </div>
      )}
    </div>
  );
}
