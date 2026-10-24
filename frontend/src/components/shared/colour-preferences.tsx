'use client';

import { useEffect, useState } from 'react';

import {
  ACCENTS,
  applyColours,
  BACKGROUNDS,
  DEFAULT_COLOURS,
  loadColours,
  PALETTES,
  saveColours,
  STARTING,
  type ColourPreferences,
} from '@/lib/appearance/colours';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';

/**
 * Applies the colours this browser chose, after the first render: the server
 * renders the stylesheet's defaults, so applying them in an effect keeps the
 * hydrated markup identical.
 */
export function ApplyColourPreferences() {
  useEffect(() => {
    applyColours(loadColours());
  }, []);
  return null;
}

/** Background, accent, starting-version colour and version palette, from the account menu (Sean, 18 and 21 Oct). */
export function ColourPicker() {
  const [prefs, setPrefs] = useState<ColourPreferences>(() => (typeof window === 'undefined' ? DEFAULT_COLOURS : loadColours()));
  const t = useT();
  // Every swatch has its name in each language; the id is the key.
  const name = (id: string) => t(`colour.${id === 'default' ? 'grey' : id}` as MessageKey);

  const choose = (next: Partial<ColourPreferences>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    applyColours(merged);
    saveColours(merged);
  };

  const swatch = (selected: boolean, colour: string, label: string, onPick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${selected ? 'ring-2 ring-[var(--on-surface)] ring-offset-2 ring-offset-[var(--surface-container-lowest)]' : ''}`}
      style={{ background: colour }}
    />
  );

  return (
    <div aria-label={t('header.colours')} className="space-y-3 px-4 py-2">
      <fieldset>
        <legend className="text-label text-[var(--on-surface-variant)]">{t('colours.background')}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {BACKGROUNDS.map((b) => swatch(prefs.background === b.id, b.colour, t('colours.swatch.background', { name: name(b.id) }), () => choose({ background: b.id })))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-label text-[var(--on-surface-variant)]">{t('colours.accent')}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {ACCENTS.map((a) => swatch(prefs.accent === a.id, a.colour, t('colours.swatch.accent', { name: name(a.id) }), () => choose({ accent: a.id })))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-label text-[var(--on-surface-variant)]">{t('colours.starting')}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {STARTING.map((s) => swatch(prefs.starting === s.id, s.colour, t('colours.swatch.starting', { name: name(s.id) }), () => choose({ starting: s.id })))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-label text-[var(--on-surface-variant)]">{t('colours.later')}</legend>
        <div className="mt-1.5 space-y-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choose({ palette: p.id })}
              aria-pressed={prefs.palette === p.id}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-start text-label transition-colors ${
                prefs.palette === p.id ? 'bg-[var(--surface-container-high)] text-[var(--on-surface)]' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'
              }`}
            >
              <span className="flex gap-0.5" aria-hidden>
                {p.colours.map((c) => (
                  <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />
                ))}
              </span>
              {name(p.id)}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-label text-[var(--on-surface-variant)]">{t('colours.keepNote')}</p>
      <button
        type="button"
        onClick={() => choose(DEFAULT_COLOURS)}
        className="text-label text-[var(--pm-primary)] hover:underline"
      >
        {t('colours.reset')}
      </button>
      <p className="text-label leading-snug text-[var(--on-surface-variant)]">{t('colours.keptHere')}</p>
    </div>
  );
}

/**
 * The colours, one click from the page itself — the start screen and the
 * landing page — and not only from the account menu (Sean, 22 Oct: "if they
 * are demo'ing, they can change it to pink").
 */
export function ColourMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const t = useT();
  return (
    <details className="relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-label ${
          tone === 'dark' ? 'text-white/70 hover:text-white' : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
        }`}
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">palette</span>
        {/* The word only where there is room: on a phone the landing header held the logo, beta, this and Sign in (24 Oct). */}
        <span className="max-sm:sr-only whitespace-nowrap">{t('header.colours')}</span>
      </summary>
      <div className="absolute end-0 z-50 mt-2 w-72 rounded-xl bg-[var(--surface-container-lowest)] py-2 text-[var(--on-surface)] shadow-[0_12px_32px_-12px_rgba(25,28,30,0.35)]">
        <ColourPicker />
      </div>
    </details>
  );
}
